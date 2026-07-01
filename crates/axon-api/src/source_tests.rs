use chrono::Utc;
use serde_json::json;
use uuid::Uuid;

use super::*;

#[test]
fn local_file_request_serializes_to_contract_shape() {
    let request = SourceRequest::local_path("/tmp/example.md", false);
    let value = serde_json::to_value(&request).expect("serialize source request");

    assert_eq!(value["source"], "/tmp/example.md");
    assert_eq!(value["intent"], "acquire");
    assert_eq!(value["embed"], true);
    assert_eq!(value["refresh"], "if_stale");
    assert_eq!(value["watch"], "disabled");
    assert_eq!(value["execution"]["mode"], "background");
    assert_eq!(value["execution"]["priority"], "normal");
    assert_eq!(value["output"]["response_mode"], "auto");
    assert_eq!(value["output"]["artifact_mode"], "on_large_output");
    assert_eq!(value["scope"], "file");
    assert_eq!(value["adapter"], "local");
}

#[test]
fn source_request_deserializes_with_defaults_for_minimal_input() {
    let request: SourceRequest =
        serde_json::from_value(json!({ "source": "shadcn.com" })).expect("minimal request");

    assert_eq!(request.source, "shadcn.com");
    assert_eq!(request.intent, SourceIntent::Acquire);
    assert_eq!(request.refresh, SourceRefreshPolicy::IfStale);
    assert_eq!(request.watch, SourceWatchPolicy::Disabled);
    assert_eq!(request.execution.mode, ExecutionMode::Background);
    assert_eq!(request.execution.priority, JobPriority::Normal);
    assert!(request.embed);
    assert!(request.options.values.is_empty());
    assert!(request.metadata.is_empty());
}

#[test]
fn source_request_rejects_unknown_external_fields() {
    let err = serde_json::from_value::<SourceRequest>(json!({
        "source": "github.com/jmagar/axon",
        "old_embed_request_field": true
    }))
    .expect_err("unknown fields must fail");

    assert!(err.to_string().contains("unknown field"), "{err}");
}

#[test]
fn enum_wire_values_are_snake_case_and_closed() {
    assert_eq!(
        serde_json::to_value(SourceKind::McpTool).unwrap(),
        json!("mcp_tool")
    );
    assert_eq!(
        serde_json::to_value(SourceScope::PullRequest).unwrap(),
        json!("pull_request")
    );
    assert_eq!(
        serde_json::to_value(PipelinePhase::Vectorizing).unwrap(),
        json!("vectorizing")
    );

    let err = serde_json::from_value::<SourceKind>(json!("mystery_source"))
        .expect_err("unknown source kind must fail");
    assert!(err.to_string().contains("unknown variant"), "{err}");
}

#[test]
fn force_refresh_and_watch_helpers_set_intent_without_disabling_embedding() {
    let refresh =
        SourceRequest::new("github.com/jmagar/axon").with_refresh(SourceRefreshPolicy::Force);
    assert_eq!(refresh.intent, SourceIntent::Refresh);
    assert_eq!(refresh.refresh, SourceRefreshPolicy::Force);
    assert!(refresh.embed);

    let watch =
        SourceRequest::local_path("/workspace/axon", true).with_watch(SourceWatchPolicy::Ensure);
    assert_eq!(watch.intent, SourceIntent::Watch);
    assert_eq!(watch.watch, SourceWatchPolicy::Ensure);
    assert_eq!(watch.scope, Some(SourceScope::Directory));
    assert!(watch.embed);
}

#[test]
fn stage_execution_result_wraps_payload_with_required_header() {
    let header = StageResultHeader {
        job_id: JobId(Uuid::new_v4()),
        stage_id: StageId(Uuid::new_v4()),
        phase: PipelinePhase::Resolving,
        status: LifecycleStatus::Completed,
        started_at: Utc::now(),
        completed_at: Some(Utc::now()),
        counts: StageCounts {
            items_total: Some(1),
            items_done: 1,
            documents_total: None,
            documents_done: 0,
            chunks_total: None,
            chunks_done: 0,
            bytes_total: None,
            bytes_done: 0,
        },
        warnings: Vec::new(),
        error: None,
    };
    let result = StageExecutionResult {
        header,
        data: SourceRequest::new("shadcn.com"),
    };
    let value = serde_json::to_value(&result).expect("stage result");

    assert_eq!(value["header"]["phase"], "resolving");
    assert_eq!(value["header"]["status"], "completed");
    assert_eq!(value["data"]["source"], "shadcn.com");
}

#[test]
fn source_document_and_prepared_document_carry_generation_identity() {
    let doc = SourceDocument {
        document_id: DocumentId::from("doc_local_readme"),
        source_id: SourceId::from("src_local_workspace"),
        source_item_key: SourceItemKey::from("README.md"),
        canonical_uri: "file:///workspace/README.md".to_string(),
        content_kind: ContentKind::Markdown,
        content: ContentRef::InlineText {
            text: "# Axon".to_string(),
        },
        metadata: MetadataMap::new(),
        title: Some("Axon".to_string()),
        language: None,
        path: Some("README.md".to_string()),
        mime_type: Some("text/markdown".to_string()),
        structured_payload: None,
        artifact_id: None,
        chunk_hints: Vec::new(),
        parser_hints: Vec::new(),
    };
    let prepared = PreparedDocument {
        document_id: doc.document_id.clone(),
        source_id: doc.source_id.clone(),
        source_item_key: doc.source_item_key.clone(),
        generation: SourceGenerationId::from("gen_0001"),
        chunks: Vec::new(),
        metadata: MetadataMap::new(),
        cleanup_keys: Vec::new(),
        graph_refs: Vec::new(),
    };

    assert_eq!(prepared.source_id, doc.source_id);
    assert_eq!(prepared.source_item_key, SourceItemKey::from("README.md"));
    assert_eq!(prepared.generation, SourceGenerationId::from("gen_0001"));
}
