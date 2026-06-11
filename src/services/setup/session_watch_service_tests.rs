use super::*;

fn test_paths() -> ServicePaths {
    ServicePaths {
        home: PathBuf::from("/home/j"),
        state_dir: PathBuf::from("/home/j/.local/state/axon"),
        env_path: PathBuf::from("/home/j/.config/axon/session-watch.env"),
        unit_path: PathBuf::from("/home/j/.config/systemd/user/session-watch-service.service"),
        axon_bin: PathBuf::from("/home/j/.local/bin/axon"),
        sqlite_path: PathBuf::from("/home/j/.axon/jobs.db"),
    }
}

#[test]
fn session_watch_env_file_uses_axon_names_and_no_ai_watch_name() {
    let env = session_watch_env_file(Path::new("/home/j/.axon/jobs.db"));
    assert!(env.contains("AXON_SQLITE_PATH=/home/j/.axon/jobs.db"));
    assert!(env.contains("RUST_LOG=warn"));
    assert!(!env.contains("CORTEX_"));
    assert!(!env.contains("ai-watch"));
}

#[test]
fn session_watch_service_unit_runs_sessions_watch_no_initial_scan() {
    let unit = session_watch_service_unit(
        Path::new("/home/j/.local/bin/axon"),
        Path::new("/home/j/.config/axon/session-watch.env"),
        Path::new("/home/j/.local/state/axon"),
        Path::new("/home/j"),
    );
    assert!(unit.contains("Description=axon real-time local AI session watch"));
    assert!(
        unit.contains("ExecStart=/home/j/.local/bin/axon sessions watch --no-initial-scan --json")
    );
    assert!(unit.contains("session-watch-service"));
    assert!(!unit.contains("axon-session-watch.service"));
    assert!(unit.contains("BindReadOnlyPaths=-/home/j/.claude/projects -/home/j/.codex/sessions -/home/j/.gemini/history -/home/j/.gemini/tmp"));
    assert!(unit.contains("ReadWritePaths=/home/j/.axon /home/j/.local/state/axon"));
    assert!(!unit.contains("cortex"));
    assert!(!unit.contains("ai-watch-service"));
}

#[test]
fn session_watch_install_sequence_uses_initial_ingest_then_systemd_unit() {
    let paths = test_paths();
    assert_eq!(
        initial_ingest_command(&paths),
        CommandSpec::new(
            "/home/j/.local/bin/axon",
            ["sessions", "--wait", "true", "--json"]
        )
    );
    assert_eq!(
        daemon_reload_command(),
        CommandSpec::new("systemctl", ["--user", "daemon-reload"])
    );
    assert_eq!(
        enable_now_command(),
        CommandSpec::new(
            "systemctl",
            ["--user", "enable", "--now", "session-watch-service.service"]
        )
    );
}
