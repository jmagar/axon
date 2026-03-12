#[test]
fn async_subprocess_modes_does_not_include_ingest_modes() {
    for mode in ["github", "reddit", "youtube"] {
        assert!(
            !super::constants::ASYNC_SUBPROCESS_MODES.contains(&mode),
            "ingest mode must not use subprocess fallback: {mode}"
        );
    }
}
