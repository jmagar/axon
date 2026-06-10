use super::*;

#[test]
fn format_trim_env_value_roundtrip_with_special_characters() {
    for raw in [
        "simple",
        "with spaces",
        "with#hash",
        "with$dollar",
        r#"with"quotes"#,
        "with'single",
        r"with\backslash",
        "",
    ] {
        let formatted = format_env_value(raw);
        let recovered = trim_env_value(&formatted);
        assert_eq!(
            recovered, raw,
            "round-trip failed for {raw:?}: formatted={formatted:?} recovered={recovered:?}"
        );
    }
}
