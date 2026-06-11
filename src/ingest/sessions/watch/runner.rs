use super::process::{
    process_pending, process_session_batch_for_watch, redact_error_detail, validate_event_path,
};
use super::queue::PendingFiles;
use super::targets::{
    WatchTarget, canonical_path_allowed, collect_validated_files, collect_watch_dirs,
    handle_remove_path, watch_targets,
};
use super::validate::SessionWatchRoots;
use super::{MAX_WATCH_DIRS, SessionWatchOptions, WATCH_EVENT_BUFFER};
use crate::core::config::Config;
use crate::services::context::ServiceContext;
use anyhow::{Result, anyhow};
use notify::Watcher;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

pub async fn run_session_watch(
    cfg: &Config,
    service_context: &ServiceContext,
    options: SessionWatchOptions,
) -> Result<()> {
    let roots = SessionWatchRoots::from_config(cfg)?;
    let targets = watch_targets(cfg, &roots, &options)?;
    if targets.is_empty() {
        return Err(anyhow!("no AI session roots exist to watch"));
    }
    let pool = service_context
        .jobs
        .sqlite_pool()
        .ok_or_else(|| anyhow!("session watch requires the SQLite job runtime"))?;
    let overflow_rescan = Arc::new(AtomicBool::new(false));
    let prune_missing = Arc::new(AtomicBool::new(false));
    let (tx, mut rx) =
        tokio::sync::mpsc::channel::<notify::Result<notify::Event>>(WATCH_EVENT_BUFFER);
    let callback_rescan = Arc::clone(&overflow_rescan);
    let callback_prune_missing = Arc::clone(&prune_missing);
    let mut watcher = notify::RecommendedWatcher::new(
        move |event| {
            if tx.try_send(event).is_err() {
                callback_rescan.store(true, Ordering::Relaxed);
                callback_prune_missing.store(true, Ordering::Relaxed);
            }
        },
        notify::Config::default().with_follow_symlinks(false),
    )?;

    let mut watched_dirs = BTreeSet::new();
    for target in &targets {
        watch_directory_tree(&mut watcher, target.root(), &mut watched_dirs)?;
    }
    if watched_dirs.is_empty() {
        return Err(anyhow!(
            "no accessible AI session directories exist to watch"
        ));
    }

    if options.initial_scan {
        run_initial_rescan(
            cfg,
            service_context,
            pool.as_ref(),
            &roots,
            &targets,
            &options,
        )
        .await;
    }

    let tick_duration = options
        .debounce
        .min(options.settle)
        .max(Duration::from_millis(50));
    let mut tick = tokio::time::interval(tick_duration);
    let mut pending = PendingFiles::default();
    let mut last_rescan = None;

    loop {
        tokio::select! {
            Some(event) = rx.recv() => {
                for dir in handle_event(
                    event,
                    &roots,
                    &targets,
                    &mut pending,
                    overflow_rescan.as_ref(),
                    prune_missing.as_ref(),
                ) {
                    watch_directory_tree(&mut watcher, &dir, &mut watched_dirs)?;
                    overflow_rescan.store(true, Ordering::Relaxed);
                }
            }
            _ = tick.tick() => {
                handle_tick(
                    TickContext {
                        cfg,
                        service_context,
                        pool: pool.as_ref(),
                        roots: &roots,
                        targets: &targets,
                        options: &options,
                        prune_missing: prune_missing.as_ref(),
                        overflow_rescan: overflow_rescan.as_ref(),
                    },
                    &mut pending,
                    &mut last_rescan,
                )
                .await;
            }
            _ = shutdown_signal() => {
                tracing::info!("session watcher stopping");
                return Ok(());
            }
        }
    }
}

fn watch_directory_tree(
    watcher: &mut notify::RecommendedWatcher,
    root: &Path,
    watched_dirs: &mut BTreeSet<PathBuf>,
) -> Result<()> {
    for dir in collect_watch_dirs(root)? {
        if watched_dirs.contains(&dir) {
            continue;
        }
        if watched_dirs.len() >= MAX_WATCH_DIRS {
            return Err(anyhow!(
                "session watcher directory budget exceeded ({MAX_WATCH_DIRS}); use a narrower --path or raise system inotify limits"
            ));
        }
        watcher.watch(&dir, notify::RecursiveMode::NonRecursive)?;
        watched_dirs.insert(dir);
    }
    Ok(())
}

fn handle_event(
    event: notify::Result<notify::Event>,
    roots: &SessionWatchRoots,
    targets: &[WatchTarget],
    pending: &mut PendingFiles,
    overflow_rescan: &AtomicBool,
    prune_missing: &AtomicBool,
) -> Vec<PathBuf> {
    let mut new_dirs = Vec::new();
    match event {
        Ok(event) => {
            if event.need_rescan() {
                overflow_rescan.store(true, Ordering::Relaxed);
                return new_dirs;
            }
            if event.kind.is_create() || event.kind.is_modify() {
                let now = Instant::now();
                for path in event.paths {
                    if event.kind.is_create()
                        && path.is_dir()
                        && targets.iter().all(|target| target.allowed_file().is_none())
                    {
                        new_dirs.push(path);
                    } else if let Some(validated) = validate_event_path(roots, &path)
                        && canonical_path_allowed(&validated.canonical, targets)
                        && !pending.push(validated.canonical, now)
                    {
                        pending.clear();
                        overflow_rescan.store(true, Ordering::Relaxed);
                    }
                }
            } else if event.kind.is_remove() {
                for path in event.paths {
                    handle_remove_path(
                        &path,
                        roots,
                        targets,
                        pending,
                        overflow_rescan,
                        prune_missing,
                    );
                }
            }
        }
        Err(error) => tracing::warn!(
            detail = %redact_error_detail(&error.to_string()),
            "session watch event failed"
        ),
    }
    new_dirs
}

async fn run_initial_rescan(
    cfg: &Config,
    service_context: &ServiceContext,
    pool: &sqlx::SqlitePool,
    roots: &SessionWatchRoots,
    targets: &[WatchTarget],
    options: &SessionWatchOptions,
) {
    for target in targets {
        let files = collect_validated_files(roots, target);
        for batch in files.chunks(options.max_batch_docs.max(1)) {
            if let Err(error) =
                process_session_batch_for_watch(cfg, service_context, pool, batch.to_vec(), options)
                    .await
            {
                tracing::warn!(
                    detail = %redact_error_detail(&error.to_string()),
                    "session watch initial rescan batch failed"
                );
            }
        }
    }
}

struct TickContext<'a> {
    cfg: &'a Config,
    service_context: &'a ServiceContext,
    pool: &'a sqlx::SqlitePool,
    roots: &'a SessionWatchRoots,
    targets: &'a [WatchTarget],
    options: &'a SessionWatchOptions,
    prune_missing: &'a AtomicBool,
    overflow_rescan: &'a AtomicBool,
}

async fn handle_tick(
    ctx: TickContext<'_>,
    pending: &mut PendingFiles,
    last_rescan: &mut Option<Instant>,
) {
    if ctx.prune_missing.swap(false, Ordering::Relaxed) {
        mark_missing_checkpoints(ctx.options.json);
    }
    if ctx.overflow_rescan.swap(false, Ordering::Relaxed) {
        run_initial_rescan_with_cooldown(
            ctx.cfg,
            ctx.service_context,
            ctx.pool,
            ctx.roots,
            ctx.targets,
            ctx.options,
            last_rescan,
        )
        .await;
    }
    process_pending(
        ctx.cfg,
        ctx.service_context,
        ctx.pool,
        ctx.roots,
        ctx.options,
        pending,
    )
    .await;
}

async fn run_initial_rescan_with_cooldown(
    cfg: &Config,
    service_context: &ServiceContext,
    pool: &sqlx::SqlitePool,
    roots: &SessionWatchRoots,
    targets: &[WatchTarget],
    options: &SessionWatchOptions,
    last_rescan: &mut Option<Instant>,
) {
    let now = Instant::now();
    if last_rescan.is_some_and(|last| now.duration_since(last) < options.rescan_cooldown) {
        return;
    }
    *last_rescan = Some(now);
    run_initial_rescan(cfg, service_context, pool, roots, targets, options).await;
}

fn mark_missing_checkpoints(json: bool) {
    if json {
        emit_status("prune_missing", "checkpoint pruning deferred");
    }
}

fn emit_status(stage: &str, result: &str) {
    println!(
        "{}",
        serde_json::json!({ "stage": stage, "result": result })
    );
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut terminate) => {
                tokio::select! {
                    _ = tokio::signal::ctrl_c() => {}
                    _ = terminate.recv() => {}
                }
            }
            Err(error) => {
                tracing::warn!(
                    detail = %redact_error_detail(&error.to_string()),
                    "failed to install SIGTERM handler for session watcher"
                );
                let _ = tokio::signal::ctrl_c().await;
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
