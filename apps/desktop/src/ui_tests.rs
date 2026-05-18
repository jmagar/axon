use super::*;

#[test]
fn elapsed_label_subsecond_shows_tenths() {
    assert_eq!(format_elapsed(Duration::from_millis(0)), "0.0s");
    assert_eq!(format_elapsed(Duration::from_millis(400)), "0.4s");
    assert_eq!(format_elapsed(Duration::from_millis(999)), "0.9s");
}

#[test]
fn elapsed_label_seconds_no_decimal() {
    assert_eq!(format_elapsed(Duration::from_secs(1)), "1s");
    assert_eq!(format_elapsed(Duration::from_secs(12)), "12s");
    assert_eq!(format_elapsed(Duration::from_secs(59)), "59s");
}

#[test]
fn elapsed_label_minutes_uses_padded_seconds() {
    assert_eq!(format_elapsed(Duration::from_secs(60)), "1m 00s");
    assert_eq!(format_elapsed(Duration::from_secs(63)), "1m 03s");
    assert_eq!(format_elapsed(Duration::from_secs(125)), "2m 05s");
}

#[test]
fn parse_env_line_accepts_plain_and_quoted_values() {
    assert_eq!(
        parse_env_line("TEI_URL=http://axon-tei:80"),
        Some(("TEI_URL", "http://axon-tei:80".to_string()))
    );
    assert_eq!(
        parse_env_line("QDRANT_URL=\"http://axon-qdrant:6333\""),
        Some(("QDRANT_URL", "http://axon-qdrant:6333".to_string()))
    );
    assert_eq!(
        parse_env_line("TAVILY_API_KEY='secret'"),
        Some(("TAVILY_API_KEY", "secret".to_string()))
    );
}

#[test]
fn parse_env_line_ignores_comments_and_bad_lines() {
    assert_eq!(parse_env_line("# TEI_URL=x"), None);
    assert_eq!(parse_env_line(""), None);
    assert_eq!(parse_env_line("not an assignment"), None);
    assert_eq!(parse_env_line("=missing-key"), None);
}
