use super::{MAX_SSE_LINE_BYTES, drain_sse_lines, parse_sse_data_line as parse_data_line};

#[test]
fn parse_sse_data_line() {
    assert_eq!(
        parse_data_line("data: {\"type\":\"delta\",\"text\":\"hi\"}"),
        Some("{\"type\":\"delta\",\"text\":\"hi\"}".to_string())
    );
}

#[test]
fn ignores_non_data_sse_line() {
    assert_eq!(parse_data_line("event: delta"), None);
}

#[test]
fn buffers_split_utf8_until_complete_line() {
    let mut pending = Vec::new();
    let snowman = "data: {\"type\":\"delta\",\"text\":\"☃\"}\n".as_bytes();
    assert!(
        drain_sse_lines(&mut pending, &snowman[..snowman.len() - 2])
            .unwrap()
            .is_empty()
    );

    let lines = drain_sse_lines(&mut pending, &snowman[snowman.len() - 2..]).unwrap();

    assert_eq!(lines, vec!["data: {\"type\":\"delta\",\"text\":\"☃\"}"]);
    assert!(pending.is_empty());
}

#[test]
fn rejects_oversized_sse_line() {
    let mut pending = Vec::new();
    // Build a chunk larger than MAX_SSE_LINE_BYTES with no newline.
    let big_chunk = vec![b'x'; MAX_SSE_LINE_BYTES + 1];
    let result = drain_sse_lines(&mut pending, &big_chunk);
    assert!(
        result.is_err(),
        "oversized lineless chunk must return an error"
    );
    let msg = result.unwrap_err();
    assert!(
        msg.contains("exceeded") || msg.contains("exceeds"),
        "error message should describe the size violation: {msg}"
    );
}

#[test]
fn accepts_valid_sse_event_within_limit() {
    let mut pending = Vec::new();
    let line = "data: {\"type\":\"done\",\"answer\":\"ok\"}\n";
    let lines = drain_sse_lines(&mut pending, line.as_bytes()).unwrap();
    assert_eq!(lines, vec!["data: {\"type\":\"done\",\"answer\":\"ok\"}"]);
    assert!(pending.is_empty());
}
