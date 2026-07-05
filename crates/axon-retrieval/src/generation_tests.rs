use axon_api::source::{SourceGenerationId, SourceId, Visibility};
use serde_json::json;

use crate::engine::search_filters;
use crate::plan::RetrievalPlan;

#[test]
fn generation_filter_excludes_staged_vectors_by_default() {
    let plan = RetrievalPlan {
        collection: "axon-test".to_string(),
        limit: 10,
        source_id: Some(SourceId::new("src_local_repo")),
        generation: Some(SourceGenerationId::new("42")),
        allowed_visibility: vec![Visibility::Public],
        namespace_filters: Vec::new(),
        byte_budget: 4096,
        token_budget: 512,
    };

    let filters = search_filters(&plan).expect("generation-safe retrieval filters");

    assert_eq!(filters["source_id"], json!("src_local_repo"));
    assert_eq!(filters["committed_generation"], json!(42));
    assert_eq!(filters["visibility"], json!(["public"]));
    assert_eq!(filters["redaction_status"], json!("clean"));
}
