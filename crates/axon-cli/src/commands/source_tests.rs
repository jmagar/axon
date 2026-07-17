use super::*;

use axon_api::source::{Severity, SourceItemKey};

fn warning(message: &str) -> SourceWarning {
    SourceWarning {
        code: "test.warning".to_string(),
        severity: Severity::Warning,
        message: message.to_string(),
        source_item_key: Some(SourceItemKey::from("item")),
        retryable: false,
    }
}

#[test]
fn grouped_warning_messages_collapses_repeats_in_first_seen_order() {
    let warnings = vec![
        warning("requested parser is not registered: web"),
        warning("pre-chunk redaction pass scrubbed sensitive values before chunking"),
        warning("requested parser is not registered: web"),
        warning("requested parser is not registered: web"),
    ];

    let grouped = grouped_warning_messages(&warnings);

    assert_eq!(
        grouped,
        vec![
            ("requested parser is not registered: web", 3),
            (
                "pre-chunk redaction pass scrubbed sensitive values before chunking",
                1
            ),
        ]
    );
}

#[test]
fn grouped_warning_messages_keeps_unique_messages_untouched() {
    let warnings = vec![warning("one"), warning("two")];

    assert_eq!(
        grouped_warning_messages(&warnings),
        vec![("one", 1), ("two", 1)]
    );
}
