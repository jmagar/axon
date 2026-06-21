use super::*;
use crate::oauth::store::StoredCredentials;

fn creds(server: &str) -> StoredCredentials {
    StoredCredentials {
        client_id: "c".to_string(),
        access_token: "a".into(),
        refresh_token: None,
        token_endpoint: format!("{server}/token"),
        expires_at_unix: 4_102_444_800,
        scope: "axon:read axon:write".to_string(),
        server_url: server.to_string(),
    }
}

#[test]
fn pick_token_prefers_oauth_then_static() {
    assert_eq!(
        pick_token(Some("oauth".to_string()), Some("static".to_string())),
        Some("oauth".to_string())
    );
    assert_eq!(
        pick_token(None, Some("static".to_string())),
        Some("static".to_string())
    );
    assert_eq!(pick_token(None, None), None);
}

#[test]
fn status_for_reports_signed_in_only_when_server_matches() {
    let c = creds("https://axon.example.com");

    let matched = status_for(Some(&c), "https://axon.example.com");
    assert!(matched.signed_in);
    assert_eq!(matched.scope.as_deref(), Some("axon:read axon:write"));

    // Credentials for a different server → not signed in here, but the stored
    // server_url is surfaced so the UI can explain the mismatch.
    let mismatched = status_for(Some(&c), "https://other.example.com");
    assert!(!mismatched.signed_in);
    assert_eq!(
        mismatched.server_url.as_deref(),
        Some("https://axon.example.com")
    );

    let none = status_for(None, "https://axon.example.com");
    assert!(!none.signed_in);
    assert!(none.server_url.is_none());
}
