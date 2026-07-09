use super::*;

#[test]
fn normalize_remote_path_rejects_nul_bytes() {
    let result = normalize_remote_path("foo\0bar");
    assert!(result.is_err());
}

#[test]
fn normalize_remote_path_accepts_a_plain_relative_path() {
    let result = normalize_remote_path("srv/axon/docker-compose.yaml");
    assert_eq!(result.unwrap(), "srv/axon/docker-compose.yaml");
}

#[test]
fn normalize_remote_path_accepts_an_absolute_path() {
    let result = normalize_remote_path("/srv/axon");
    assert_eq!(result.unwrap(), "/srv/axon");
}

#[test]
fn new_connection_id_is_a_valid_uuid_not_a_sequential_counter() {
    let a = new_connection_id();
    let b = new_connection_id();
    assert_ne!(a, b);
    assert!(uuid::Uuid::parse_str(&a).is_ok());
    // A monotonic-counter scheme like "sftp-1"/"sftp-2" would fail this parse
    // — this test exists specifically to catch a regression back to a
    // sequential/guessable id.
}
