use std::path::PathBuf;

fn find_dotenv_from_launch_context() -> Option<PathBuf> {
    let mut roots = Vec::new();

    if let Ok(exe) = std::env::current_exe()
        && let Some(parent) = exe.parent()
    {
        roots.push(parent.to_path_buf());
    }
    if let Ok(cwd) = std::env::current_dir() {
        roots.push(cwd);
    }

    for root in roots {
        for dir in root.ancestors() {
            let candidate = dir.join(".env");
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn load_dotenv() {
    if let Some(explicit) = std::env::var_os("AXON_ENV_FILE").map(PathBuf::from) {
        match dotenvy::from_path(&explicit) {
            Ok(_) => return,
            Err(dotenvy::Error::Io(ref e)) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                eprintln!(
                    "warning: failed to load AXON_ENV_FILE ({}): {e}",
                    explicit.display()
                );
            }
        }
    }

    if let Some(path) = find_dotenv_from_launch_context() {
        match dotenvy::from_path(&path) {
            Ok(_) => return,
            Err(dotenvy::Error::Io(ref e)) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => {
                eprintln!("warning: failed to load .env from {}: {e}", path.display());
                return;
            }
        }
    }

    match dotenvy::dotenv() {
        Ok(_) => {}
        Err(dotenvy::Error::Io(ref e)) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            eprintln!("warning: failed to load .env: {e}");
        }
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // ACP sessions consume one spawn_blocking thread each for up to 300s (ACP_ADAPTER_TIMEOUT).
    // max_blocking_threads caps the pool to prevent silent exhaustion that would starve
    // DB queries and file I/O. At 64 threads: ~0.2 new ACP sessions/second sustained
    // (64 concurrent sessions max). Override with AXON_MAX_BLOCKING_THREADS env var.
    // See: docs/reports/acp-performance-scalability-analysis-2026-03-08.md FINDING-6
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .max_blocking_threads(acp_blocking_thread_limit())
        .build()
        .expect("failed to build tokio runtime");
    rt.block_on(async_main())
}

fn acp_blocking_thread_limit() -> usize {
    // Default: 64 blocking threads dedicated to ACP + other blocking work.
    // At 300s max session time, this supports ~0.2 new sessions/second sustained,
    // or ~64 concurrent sessions. For homelab single-user use, 16–32 is sufficient.
    // Override with AXON_MAX_BLOCKING_THREADS env var.
    std::env::var("AXON_MAX_BLOCKING_THREADS")
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(64)
}

async fn async_main() -> Result<(), Box<dyn std::error::Error>> {
    // Install aws-lc-rs as the process-level rustls crypto provider before any
    // TLS connections are made. Both ring (via lapin) and aws-lc-rs (via octocrab /
    // spider / reqwest 0.12) are compiled into the same binary, so rustls 0.23
    // cannot auto-select one and panics without this call. Returns Err if already
    // installed (e.g. in tests) — safe to ignore.
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    load_dotenv();
    axon::run().await
}
