use crate::context::ServiceContext;
use crate::query;
use crate::types::CodeSearchCaller;
use anyhow::Result;
use axon_code_index::manifest::collect_git_files;
use axon_core::config::CodeSearchWatchConfig;
use axon_core::paths::axon_home_dir;
use axon_vector::ops::file_ingest::{SelectionPolicy, collect_files};
use axon_vector::ops::input::select;
use notify::Watcher;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};
use std::io;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

const WATCH_EVENT_BUFFER: usize = 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum CodeSearchWatchEvent {
    Started {
        watch_dirs: Vec<PathBuf>,
        roots: Vec<PathBuf>,
        initial_refresh: bool,
    },
    RefreshStarted {
        root: PathBuf,
        reason: &'static str,
    },
    RefreshFinished {
        root: PathBuf,
        status: String,
        warning: Option<String>,
        indexed_files: usize,
        removed_files: usize,
        generation: Option<i64>,
    },
    RefreshFailed {
        root: PathBuf,
        error: String,
    },
    Pending {
        root: PathBuf,
        paths: usize,
    },
    DryRun {
        plan: CodeSearchWatchDryRunPlan,
    },
    Enabled {
        unit_path: PathBuf,
        env_path: PathBuf,
        roots: Vec<PathBuf>,
    },
    Stopped,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CodeSearchWatchDryRunPlan {
    pub roots: Vec<CodeSearchWatchDryRunRoot>,
    pub total_files: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct CodeSearchWatchDryRunRoot {
    pub root: PathBuf,
    pub files: Vec<String>,
}

pub trait CodeSearchWatchEventSink: Sync {
    fn emit(&self, event: CodeSearchWatchEvent);
}

pub struct StdoutCodeSearchWatchEventSink {
    pub json: bool,
}

impl CodeSearchWatchEventSink for StdoutCodeSearchWatchEventSink {
    fn emit(&self, event: CodeSearchWatchEvent) {
        if self.json {
            match serde_json::to_string(&event) {
                Ok(line) => println!("{line}"),
                Err(error) => println!(
                    "{{\"event\":\"serialization_failed\",\"error\":{}}}",
                    serde_json::json!(error.to_string())
                ),
            }
            return;
        }

        match event {
            CodeSearchWatchEvent::Started {
                watch_dirs,
                roots,
                initial_refresh,
            } => println!(
                "code-search watcher started: {} watch dir(s), {} repo{}{}",
                watch_dirs.len(),
                roots.len(),
                if roots.len() == 1 { "" } else { "s" },
                if initial_refresh {
                    " (initial refresh enabled)"
                } else {
                    ""
                }
            ),
            CodeSearchWatchEvent::RefreshStarted { root, reason } => {
                println!("code-search refresh started: {} {reason}", root.display());
            }
            CodeSearchWatchEvent::RefreshFinished {
                root,
                status,
                warning,
                indexed_files,
                removed_files,
                generation,
            } => {
                let generation = generation
                    .map(|generation| generation.to_string())
                    .unwrap_or_else(|| "none".to_string());
                println!(
                    "code-search refresh finished: {} status={status} indexed={indexed_files} removed={removed_files} generation={generation}",
                    root.display()
                );
                if let Some(warning) = warning {
                    println!("code-search refresh warning: {warning}");
                }
            }
            CodeSearchWatchEvent::RefreshFailed { root, error } => {
                println!("code-search refresh failed: {} {error}", root.display());
            }
            CodeSearchWatchEvent::Pending { root, paths } => {
                println!(
                    "code-search watcher queued changes: {} {paths} path(s)",
                    root.display()
                );
            }
            CodeSearchWatchEvent::DryRun { plan } => {
                println!(
                    "code-search dry-run: {} repo(s), {} file(s)",
                    plan.roots.len(),
                    plan.total_files
                );
                for root in plan.roots {
                    println!("{}", root.root.display());
                    for file in root.files {
                        println!("  {file}");
                    }
                }
            }
            CodeSearchWatchEvent::Enabled {
                unit_path,
                env_path,
                roots,
            } => {
                println!(
                    "code-search watcher enabled: {} repo root(s), unit={}, env={}",
                    roots.len(),
                    unit_path.display(),
                    env_path.display()
                );
            }
            CodeSearchWatchEvent::Stopped => println!("code-search watcher stopped"),
        }
    }
}

pub async fn run_code_search_watch(
    ctx: &ServiceContext,
    options: CodeSearchWatchConfig,
    events: &dyn CodeSearchWatchEventSink,
) -> Result<()> {
    let watch_dirs = code_search_watch_dirs(&options)?;
    if options.dry_run {
        let plan = build_code_search_watch_dry_run_plan(&watch_dirs).await?;
        events.emit(CodeSearchWatchEvent::DryRun { plan });
        return Ok(());
    }
    if options.enable {
        let report = enable_code_search_watch_service(&watch_dirs, &options)?;
        events.emit(CodeSearchWatchEvent::Enabled {
            unit_path: report.unit_path,
            env_path: report.env_path,
            roots: report.roots,
        });
        return Ok(());
    }
    let mut roots = discover_code_search_watch_roots_for_dirs(&watch_dirs)?;
    if roots.is_empty() {
        return Err(anyhow::anyhow!(
            "code-search-watch found no Git checkouts to watch"
        ));
    }
    roots.sort();
    roots.dedup();
    events.emit(CodeSearchWatchEvent::Started {
        watch_dirs: watch_dirs.clone(),
        roots: roots.clone(),
        initial_refresh: options.initial_refresh,
    });
    if options.initial_refresh {
        for root in &roots {
            refresh_code_search_watch_root(ctx, events, root, "initial").await;
        }
    }

    let overflow_rescan = Arc::new(AtomicBool::new(false));
    let (tx, mut rx) =
        tokio::sync::mpsc::channel::<notify::Result<notify::Event>>(WATCH_EVENT_BUFFER);
    let callback_rescan = Arc::clone(&overflow_rescan);
    let mut watcher = notify::RecommendedWatcher::new(
        move |event| {
            if tx.try_send(event).is_err() {
                callback_rescan.store(true, Ordering::Relaxed);
            }
        },
        notify::Config::default().with_follow_symlinks(false),
    )?;
    for root in &roots {
        watcher.watch(root, notify::RecursiveMode::Recursive)?;
    }

    let tick_duration = options
        .debounce
        .min(options.settle)
        .max(Duration::from_millis(50));
    let refresh_delay = options.debounce.saturating_add(options.settle);
    let mut tick = tokio::time::interval(tick_duration);
    let mut dirty: BTreeMap<PathBuf, DirtyRoot> = BTreeMap::new();

    loop {
        tokio::select! {
            Some(event) = rx.recv() => {
                for root in code_search_watch_dirty_roots(&roots, event, overflow_rescan.as_ref()) {
                    let entry = dirty.entry(root.clone()).or_insert_with(|| DirtyRoot {
                        since: Instant::now(),
                        paths: 0,
                    });
                    entry.since = Instant::now();
                    entry.paths = entry.paths.saturating_add(1);
                    events.emit(CodeSearchWatchEvent::Pending {
                        root,
                        paths: entry.paths,
                    });
                }
            }
            _ = tick.tick() => {
                if overflow_rescan.swap(false, Ordering::Relaxed) {
                    let now = Instant::now();
                    for root in &roots {
                        dirty.entry(root.clone()).or_insert(DirtyRoot {
                            since: now,
                            paths: 1,
                        });
                    }
                }
                let due = dirty
                    .iter()
                    .filter_map(|(root, state)| {
                        (state.since.elapsed() >= refresh_delay).then_some(root.clone())
                    })
                    .collect::<Vec<_>>();
                for root in due {
                    dirty.remove(&root);
                    refresh_code_search_watch_root(ctx, events, &root, "file_change").await;
                }
            }
            _ = shutdown_signal() => {
                events.emit(CodeSearchWatchEvent::Stopped);
                return Ok(());
            }
        }
    }
}

fn code_search_watch_dirs(options: &CodeSearchWatchConfig) -> Result<Vec<PathBuf>> {
    let raw = if options.roots.is_empty() {
        vec![std::env::current_dir()?]
    } else {
        options.roots.clone()
    };
    raw.into_iter()
        .map(|path| std::fs::canonicalize(path).map_err(Into::into))
        .collect()
}

fn discover_code_search_watch_roots_for_dirs(watch_dirs: &[PathBuf]) -> Result<Vec<PathBuf>> {
    let mut roots = Vec::new();
    for dir in watch_dirs {
        roots.extend(discover_code_search_watch_roots(dir)?);
    }
    roots.sort();
    roots.dedup();
    Ok(roots)
}

pub async fn build_code_search_watch_dry_run_plan(
    watch_dirs: &[PathBuf],
) -> Result<CodeSearchWatchDryRunPlan> {
    let roots = discover_code_search_watch_roots_for_dirs(watch_dirs)?;
    let mut planned_roots = Vec::new();
    let mut total_files = 0usize;
    for root in roots {
        let files = collect_code_search_watch_files(&root).await?;
        let files = files
            .into_iter()
            .filter_map(|path| {
                path.strip_prefix(&root)
                    .ok()
                    .map(|rel| rel.to_string_lossy().replace('\\', "/"))
            })
            .collect::<Vec<_>>();
        total_files += files.len();
        planned_roots.push(CodeSearchWatchDryRunRoot { root, files });
    }
    Ok(CodeSearchWatchDryRunPlan {
        roots: planned_roots,
        total_files,
    })
}

async fn collect_code_search_watch_files(root: &Path) -> Result<Vec<PathBuf>> {
    match collect_git_files(root, SelectionPolicy::CodeSearch).await {
        Ok(files) => Ok(files),
        Err(_) => collect_files(root, SelectionPolicy::CodeSearch).await,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct CodeSearchWatchEnableReport {
    unit_path: PathBuf,
    env_path: PathBuf,
    roots: Vec<PathBuf>,
}

fn enable_code_search_watch_service(
    watch_dirs: &[PathBuf],
    options: &CodeSearchWatchConfig,
) -> io::Result<CodeSearchWatchEnableReport> {
    let roots = discover_code_search_watch_roots_for_dirs(watch_dirs)
        .map_err(|error| io::Error::other(error.to_string()))?;
    if roots.is_empty() {
        return Err(io::Error::other(
            "code-search-watch found no Git checkouts to enable",
        ));
    }
    let config_dir = axon_home_dir()
        .ok_or_else(|| io::Error::other("cannot determine AXON home directory"))?
        .join("config");
    std::fs::create_dir_all(&config_dir)?;
    let env_path = config_dir.join("code-search-watch.env");
    let unit_dir = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".config/systemd/user");
    std::fs::create_dir_all(&unit_dir)?;
    let unit_path = unit_dir.join("code-search-watch.service");
    let axon_bin = std::env::current_exe()?;
    std::fs::write(&env_path, "RUST_LOG=warn\n")?;
    std::fs::write(
        &unit_path,
        code_search_watch_service_unit(&axon_bin, &env_path, watch_dirs, options),
    )?;
    run_systemctl(["--user", "daemon-reload"])?;
    run_systemctl(["--user", "enable", "--now", "code-search-watch.service"])?;
    Ok(CodeSearchWatchEnableReport {
        unit_path,
        env_path,
        roots,
    })
}

fn code_search_watch_service_unit(
    axon_bin: &Path,
    env_path: &Path,
    watch_dirs: &[PathBuf],
    options: &CodeSearchWatchConfig,
) -> String {
    let mut args = String::new();
    for dir in watch_dirs {
        args.push_str(" --cwd ");
        args.push_str(&dir.display().to_string());
    }
    args.push_str(" --debounce-ms ");
    args.push_str(&options.debounce.as_millis().to_string());
    args.push_str(" --settle-ms ");
    args.push_str(&options.settle.as_millis().to_string());
    if options.initial_refresh {
        args.push_str(" --initial-refresh");
    }
    if options.json {
        args.push_str(" --json");
    }
    format!(
        r#"[Unit]
Description=axon local code-search watch
After=default.target

[Service]
Type=simple
EnvironmentFile={}
ExecStart={} code-search-watch{}
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
SyslogIdentifier=code-search-watch

[Install]
WantedBy=default.target
"#,
        env_path.display(),
        axon_bin.display(),
        args,
    )
}

fn run_systemctl<const N: usize>(args: [&str; N]) -> io::Result<()> {
    let status = Command::new("systemctl").args(args).status()?;
    if status.success() {
        return Ok(());
    }
    Err(io::Error::other(format!(
        "systemctl {} failed with status {status}",
        args.join(" ")
    )))
}

#[derive(Debug, Clone, Copy)]
struct DirtyRoot {
    since: Instant,
    paths: usize,
}

async fn refresh_code_search_watch_root(
    ctx: &ServiceContext,
    events: &dyn CodeSearchWatchEventSink,
    root: &Path,
    reason: &'static str,
) {
    events.emit(CodeSearchWatchEvent::RefreshStarted {
        root: root.to_path_buf(),
        reason,
    });
    match query::refresh_code_search_index(ctx, Some(root), CodeSearchCaller::Cli).await {
        Ok(result) => events.emit(CodeSearchWatchEvent::RefreshFinished {
            root: root.to_path_buf(),
            status: result.freshness.status,
            warning: result.freshness.warning,
            indexed_files: result.freshness.indexed_files,
            removed_files: result.freshness.removed_files,
            generation: result.generation,
        }),
        Err(error) => events.emit(CodeSearchWatchEvent::RefreshFailed {
            root: root.to_path_buf(),
            error: error.to_string(),
        }),
    }
}

fn code_search_watch_dirty_roots(
    roots: &[PathBuf],
    event: notify::Result<notify::Event>,
    overflow_rescan: &AtomicBool,
) -> Vec<PathBuf> {
    let Ok(event) = event else {
        overflow_rescan.store(true, Ordering::Relaxed);
        return Vec::new();
    };
    if event.need_rescan() {
        overflow_rescan.store(true, Ordering::Relaxed);
        return Vec::new();
    }
    if !(event.kind.is_create() || event.kind.is_modify() || event.kind.is_remove()) {
        return Vec::new();
    }
    let mut dirty = BTreeSet::new();
    for path in event.paths {
        if let Some(root) = roots.iter().find(|root| path.starts_with(root.as_path()))
            && code_search_watch_path_is_relevant(root, &path)
        {
            dirty.insert(root.clone());
        }
    }
    dirty.into_iter().collect()
}

fn code_search_watch_path_is_relevant(root: &Path, path: &Path) -> bool {
    !code_search_watch_path_is_pruned(root, path)
}

fn discover_code_search_watch_roots(workspace: &Path) -> Result<Vec<PathBuf>> {
    if is_git_checkout_root(workspace) {
        return Ok(vec![workspace.to_path_buf()]);
    }
    let mut roots = Vec::new();
    for entry in std::fs::read_dir(workspace)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() || code_search_watch_path_is_pruned(workspace, &path) {
            continue;
        }
        if is_git_checkout_root(&path) {
            roots.push(path);
        }
    }
    roots.sort();
    Ok(roots)
}

fn is_git_checkout_root(path: &Path) -> bool {
    path.join(".git").exists()
}

fn code_search_watch_path_is_pruned(root: &Path, path: &Path) -> bool {
    let rel = path.strip_prefix(root).unwrap_or(path);
    rel.components().any(|component| match component {
        Component::Normal(name) => name.to_str().is_some_and(select::is_pruned_dir),
        _ => false,
    })
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
                tracing::warn!(%error, "failed to install SIGTERM handler for code-search watcher");
                let _ = tokio::signal::ctrl_c().await;
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn code_search_watch_ignores_noisy_pruned_paths() {
        let root = Path::new("/repo");
        assert!(!code_search_watch_path_is_relevant(
            root,
            Path::new("/repo/.git/index")
        ));
        assert!(!code_search_watch_path_is_relevant(
            root,
            Path::new("/repo/target/debug/axon")
        ));
        assert!(code_search_watch_path_is_relevant(
            root,
            Path::new("/repo/src/lib.rs")
        ));
        assert!(code_search_watch_path_is_relevant(
            root,
            Path::new("/repo/docs/reference/actions/code-search.md")
        ));
    }

    #[test]
    fn discover_code_search_watch_roots_uses_workspace_children() {
        let temp = tempfile::tempdir().expect("tempdir");
        let workspace = temp.path();
        std::fs::create_dir(workspace.join("axon")).expect("repo dir");
        std::fs::write(workspace.join("axon/.git"), "gitdir: /tmp/axon.git\n").expect("git file");
        std::fs::create_dir(workspace.join("lab")).expect("repo dir");
        std::fs::create_dir(workspace.join("lab/.git")).expect("git dir");
        std::fs::create_dir(workspace.join("notes")).expect("non repo dir");

        let roots = discover_code_search_watch_roots(workspace).expect("discover roots");

        assert_eq!(roots, vec![workspace.join("axon"), workspace.join("lab")]);
    }

    #[tokio::test]
    async fn dry_run_plan_lists_eligible_files_by_repo() {
        let temp = tempfile::tempdir().expect("tempdir");
        let workspace = temp.path();
        let axon = workspace.join("axon");
        std::fs::create_dir(&axon).expect("repo dir");
        Command::new("git")
            .arg("-C")
            .arg(&axon)
            .arg("init")
            .output()
            .expect("git init");
        std::fs::create_dir_all(workspace.join("axon/src")).expect("src dir");
        std::fs::create_dir_all(workspace.join("axon/target")).expect("target dir");
        std::fs::write(workspace.join("axon/src/lib.rs"), "fn main() {}\n").expect("source");
        std::fs::write(
            workspace.join("axon/target/generated.rs"),
            "fn generated() {}\n",
        )
        .expect("generated");
        std::fs::write(workspace.join("axon/Cargo.lock"), "# lock\n").expect("lock");
        std::fs::write(workspace.join("axon/.gitignore"), "ignored.log\n").expect("gitignore");
        std::fs::write(workspace.join("axon/ignored.log"), "ignore me\n").expect("ignored");
        let lab = workspace.join("lab");
        std::fs::create_dir(&lab).expect("repo dir");
        Command::new("git")
            .arg("-C")
            .arg(&lab)
            .arg("init")
            .output()
            .expect("git init");
        std::fs::write(workspace.join("lab/README.md"), "# lab\n").expect("doc");

        let plan = build_code_search_watch_dry_run_plan(&[workspace.to_path_buf()])
            .await
            .expect("dry run plan");

        assert_eq!(plan.roots.len(), 2);
        assert!(plan.roots[0].files.contains(&"src/lib.rs".to_string()));
        assert!(!plan.roots[0].files.contains(&"ignored.log".to_string()));
        assert!(
            !plan.roots[0]
                .files
                .contains(&"target/generated.rs".to_string())
        );
        assert!(!plan.roots[0].files.contains(&"Cargo.lock".to_string()));
        assert!(plan.roots[1].files.contains(&"README.md".to_string()));
    }
}
