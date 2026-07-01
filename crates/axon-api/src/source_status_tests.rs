use chrono::Utc;

use super::*;

#[test]
fn status_envelope_and_progress_event_round_trip() {
    let job_id = JobId(uuid::Uuid::new_v4());
    let counts = StageCounts {
        items_total: Some(10),
        items_done: 4,
        documents_total: Some(4),
        documents_done: 1,
        chunks_total: None,
        chunks_done: 0,
        bytes_total: None,
        bytes_done: 0,
    };
    let event = SourceProgressEvent {
        event_id: "evt_1".to_string(),
        sequence: 1,
        job_id,
        phase: PipelinePhase::Embedding,
        status: LifecycleStatus::Running,
        severity: Severity::Info,
        visibility: Visibility::Internal,
        message: "embedding changed files".to_string(),
        timestamp: Timestamp::from(Utc::now()),
        source_id: Some(SourceId::from("src_local")),
        canonical_uri: Some("file:///workspace".to_string()),
        adapter: Some(AdapterRef {
            name: "local".to_string(),
            version: "0.1.0".to_string(),
        }),
        scope: Some(SourceScope::Directory),
        generation: Some(SourceGenerationId::from("gen_0001")),
        counts: counts.clone(),
        current: Some(ProgressCurrent {
            source_item_key: Some(SourceItemKey::from("src/lib.rs")),
            adapter: Some("local".to_string()),
            message: None,
        }),
        throughput: None,
        retry: None,
        warning: None,
        error: None,
    };
    let envelope = SuccessEnvelope {
        ok: true,
        data: SourceStatus {
            job_id,
            source_id: SourceId::from("src_local"),
            status: LifecycleStatus::Running,
            phase: PipelinePhase::Embedding,
            heartbeat_at: Timestamp::from(Utc::now()),
            counts,
            current: event.current.clone(),
            last_error: None,
            warnings: Vec::new(),
            poll_after_ms: Some(1000),
        },
        warnings: Vec::new(),
        request_id: "req_1".to_string(),
        job: None,
    };

    let value = serde_json::to_value(&event).expect("progress event");
    assert_eq!(value["phase"], "embedding");
    assert_eq!(value["current"]["source_item_key"], "src/lib.rs");
    assert_eq!(
        serde_json::from_value::<SuccessEnvelope<SourceStatus>>(
            serde_json::to_value(&envelope).unwrap()
        )
        .unwrap(),
        envelope
    );
}

#[test]
fn watch_and_listing_dtos_are_contract_shaped() {
    let schedule = WatchSchedule {
        every_seconds: 3600,
        cron: None,
        timezone: Some("UTC".to_string()),
    };
    let request = WatchRequest {
        source: "/workspace/axon".to_string(),
        schedule: schedule.clone(),
        embed: true,
        options: AdapterOptions::default(),
        scope: Some(SourceScope::Directory),
        collection: Some("axon".to_string()),
        enabled: Some(true),
    };
    let summary = WatchSummary {
        watch_id: WatchId::from("watch_1"),
        source_id: SourceId::from("src_local"),
        enabled: true,
        schedule,
        next_run_at: Timestamp::from(Utc::now()),
        last_job_id: None,
        last_status: Some(LifecycleStatus::Completed),
    };
    let page = Page {
        items: vec![summary],
        next_cursor: None,
    };

    let value = serde_json::to_value(&request).expect("watch request");
    assert_eq!(value["schedule"]["every_seconds"], 3600);
    assert_eq!(value["scope"], "directory");
    assert_eq!(
        serde_json::from_value::<Page<WatchSummary>>(serde_json::to_value(&page).unwrap()).unwrap(),
        page
    );
}
