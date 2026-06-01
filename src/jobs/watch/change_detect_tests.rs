use super::*;
use crate::services::types::{DiffResult, DiffStatus, LinkEntry};

fn diff(status: DiffStatus, links: usize, word_delta: i64) -> DiffResult {
    let text_diff = if matches!(status, DiffStatus::Changed) {
        Some("d".into())
    } else {
        None
    };
    DiffResult {
        url_a: "a".into(),
        url_b: "b".into(),
        status,
        text_diff,
        metadata_changes: vec![],
        links_added: (0..links)
            .map(|i| LinkEntry {
                href: format!("h{i}"),
                text: "".into(),
            })
            .collect(),
        links_removed: vec![],
        word_count_delta: word_delta,
    }
}

#[test]
fn same_is_not_meaningful() {
    assert!(!is_meaningful(&diff(DiffStatus::Same, 0, 0), 0));
}
#[test]
fn any_text_change_meaningful_at_threshold_zero() {
    assert!(is_meaningful(&diff(DiffStatus::Changed, 0, 1), 0));
}
#[test]
fn sub_threshold_text_change_not_meaningful() {
    assert!(!is_meaningful(&diff(DiffStatus::Changed, 0, 2), 5));
}
#[test]
fn link_change_always_meaningful() {
    assert!(is_meaningful(&diff(DiffStatus::Changed, 1, 0), 100));
}
