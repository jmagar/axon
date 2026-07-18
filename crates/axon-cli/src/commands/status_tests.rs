use super::*;

#[test]
fn redacts_userinfo_password_keeps_host_and_path() {
    let out = redact_status_subject("https://user:supersecretpw@example.com/path/page");
    assert!(!out.contains("supersecretpw"), "password leaked: {out}");
    assert!(
        out.contains("example.com/path/page"),
        "host/path lost: {out}"
    );
}

#[test]
fn redacts_token_in_userinfo_username() {
    // GitHub-style `https://<token>@host` — the token is the username.
    let out = redact_status_subject("https://ghp_ABCDEFtokenvalue@github.com/owner/repo");
    assert!(
        !out.contains("ghp_ABCDEFtokenvalue"),
        "username token leaked: {out}"
    );
    assert!(
        out.contains("github.com/owner/repo"),
        "host/path lost: {out}"
    );
}

#[test]
fn redacts_only_sensitive_query_value() {
    let out = redact_status_subject(
        "https://api.example.com/v1/data?access_token=abc123XYZsecret&page=2",
    );
    assert!(
        !out.contains("abc123XYZsecret"),
        "token value leaked: {out}"
    );
    assert!(
        out.contains("access_token=REDACTED"),
        "key/marker lost: {out}"
    );
    assert!(out.contains("page=2"), "non-sensitive param dropped: {out}");
    assert!(
        out.contains("api.example.com/v1/data"),
        "host/path lost: {out}"
    );
}

#[test]
fn preserves_ordinary_url_byte_for_byte() {
    let subject = "https://www.reddit.com/r/rust/";
    assert_eq!(redact_status_subject(subject), subject);
}

#[test]
fn preserves_url_with_long_slug_unchanged() {
    // The shared high-entropy rule (32+ char runs) would partially redact this
    // slug; the URL-aware path must leave non-secret path segments intact —
    // this is the second half of the reported over-redaction bug.
    let subject = "https://corrode.dev/blog/2023-11-12-announcing-tokio-console-0-1-8/";
    assert_eq!(redact_status_subject(subject), subject);
}

#[test]
fn preserves_url_that_merely_contains_token_substring() {
    // The exact class the old blunt redactor wholesale-[REDACTED]'d: a URL with
    // `access_token=` in the query must keep its structure, redacting only the
    // value — never collapse the whole URL.
    let subject = "https://example.com/oauth/callback?access_token=xyz&state=ok";
    let out = redact_status_subject(subject);
    assert_ne!(out, "[REDACTED]", "whole URL was wholesale-redacted: {out}");
    assert!(
        out.contains("example.com/oauth/callback"),
        "host/path lost: {out}"
    );
    assert!(
        out.contains("state=ok"),
        "non-sensitive param dropped: {out}"
    );
    assert!(
        !out.contains("access_token=xyz"),
        "token value leaked: {out}"
    );
}

#[test]
fn non_url_subject_without_secret_passes_through() {
    // `source_type: target` style labels aren't URLs -> full scrubber runs, but
    // there's no secret here, so it should pass through unchanged.
    let subject = "reddit: r/rust";
    assert_eq!(redact_status_subject(subject), subject);
}

#[test]
fn non_url_subject_with_bare_token_is_scrubbed_by_fallback() {
    // Proves non-URL labels still hit the full `redact_secrets` scrubber.
    let subject = "target ghp_0123456789abcdefghijklmnopqrstuvwxyzABCD";
    let out = redact_status_subject(subject);
    assert!(
        !out.contains("ghp_0123456789abcdefghijklmnopqrstuvwxyzABCD"),
        "bare token leaked through fallback: {out}"
    );
}
