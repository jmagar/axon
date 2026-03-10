pub mod commands;
pub mod input;
pub mod qdrant;
pub mod ranking;
pub mod source_display;
pub mod stats;
pub mod tei;

// Re-export public API — no passthrough wrappers needed.
pub use commands::{run_evaluate_native, run_suggest_native};
pub use input::{chunk_text, url_lookup_candidates};
pub use stats::stats_payload;
pub use tei::{
    EmbedProgress, EmbedSummary, embed_code_with_metadata, embed_path_native,
    embed_path_native_with_progress, embed_text_with_extra_payload, embed_text_with_metadata,
};
