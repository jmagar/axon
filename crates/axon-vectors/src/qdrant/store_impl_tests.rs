use super::*;
use serde_json::json;

#[test]
fn detect_named_mode_collection_with_sparse_and_indexes() {
    let body = json!({
        "result": {
            "config": {
                "params": {
                    "vectors": { "dense": { "size": 1024, "distance": "Cosine" } },
                    "sparse_vectors": { "bm42": { "modifier": "idf" } }
                }
            },
            "payload_schema": {
                "source_id": { "data_type": "keyword" },
                "chunk_index": { "data_type": "integer" }
            }
        }
    });
    let spec = detect_collection_spec("axon", &body).expect("named spec");
    assert_eq!(spec.dense.name, "dense");
    assert_eq!(spec.dense.dimensions, 1024);
    assert_eq!(spec.dense.distance, VectorDistance::Cosine);
    let sparse = spec.sparse.expect("sparse config");
    assert_eq!(sparse.name, "bm42");
    assert_eq!(sparse.modifier, SparseVectorModifier::Idf);
    assert!(
        spec.payload_indexes
            .iter()
            .any(|index| index.field_name == "source_id"
                && index.field_schema == PayloadFieldSchema::Keyword)
    );
    assert!(
        spec.payload_indexes
            .iter()
            .any(|index| index.field_name == "chunk_index"
                && index.field_schema == PayloadFieldSchema::Integer)
    );
}

#[test]
fn detect_unnamed_mode_collection_uses_default_dense_name() {
    let body = json!({
        "result": { "config": { "params": {
            "vectors": { "size": 384, "distance": "Dot" }
        } } }
    });
    let spec = detect_collection_spec("legacy", &body).expect("unnamed spec");
    assert_eq!(spec.dense.name, "dense");
    assert_eq!(spec.dense.dimensions, 384);
    assert_eq!(spec.dense.distance, VectorDistance::Dot);
    assert!(spec.sparse.is_none());
}

#[test]
fn detect_returns_none_for_error_envelope() {
    let body = json!({ "status": { "error": "boom" } });
    assert!(detect_collection_spec("axon", &body).is_none());
}

#[test]
fn delete_body_for_points_lists_ids() {
    let selector = VectorDeleteSelector::Points {
        collection: "axon".to_string(),
        point_ids: vec![VectorPointId::new("p1"), VectorPointId::new("p2")],
    };
    let body = delete_body(&selector).expect("delete body");
    assert_eq!(body["points"], json!(["p1", "p2"]));
}

#[test]
fn delete_body_for_chunks_uses_any_match_filter() {
    let selector = VectorDeleteSelector::Chunks {
        collection: "axon".to_string(),
        chunk_ids: vec![ChunkId::new("c1")],
    };
    let body = delete_body(&selector).expect("delete body");
    assert_eq!(body["filter"]["must"][0]["key"], json!("chunk_id"));
    assert_eq!(body["filter"]["must"][0]["match"]["any"], json!(["c1"]));
}

#[test]
fn delete_body_for_generation_fences_on_source_and_generation() {
    let selector = VectorDeleteSelector::Generation {
        collection: "axon".to_string(),
        source_id: SourceId::new("src"),
        generation: SourceGenerationId::new("7"),
    };
    let body = delete_body(&selector).expect("delete body");
    let must = body["filter"]["must"].as_array().expect("must array");
    assert_eq!(must.len(), 2);
    let keys: Vec<&str> = must.iter().filter_map(|c| c["key"].as_str()).collect();
    assert!(keys.contains(&"source_id"));
    assert!(keys.contains(&"source_generation"));
    let generation = must
        .iter()
        .find(|condition| condition["key"] == "source_generation")
        .expect("source generation condition");
    assert_eq!(generation["match"]["value"], json!(7));
}

#[test]
fn generation_scroll_delete_uses_bounded_pages_until_offset_ends() {
    let filter = generation_delete_filter(&SourceId::new("src"), &SourceGenerationId::new("7"))
        .expect("generation filter");
    let offsets = [None, Some(json!("page-2")), Some(json!("page-3"))];
    let mut observed_limits = Vec::new();
    for offset in offsets {
        let body = generation_scroll_body(&filter, offset.as_ref());
        observed_limits.push(body["limit"].as_u64().expect("scroll limit"));
        assert_eq!(body["with_payload"], json!(false));
        assert_eq!(body["with_vector"], json!(false));
        match offset {
            Some(expected) => assert_eq!(body["offset"], expected),
            None => assert!(body.get("offset").is_none()),
        }
    }
    assert!(observed_limits.iter().all(|limit| *limit > 0));

    let mut seen = Vec::new();
    let mut next = next_delete_scroll_offset(Some(json!("page-2")));
    while let Some(offset) = next {
        seen.push(offset.clone());
        next = if offset == json!("page-2") {
            next_delete_scroll_offset(Some(json!("page-3")))
        } else {
            next_delete_scroll_offset(None)
        };
    }
    assert_eq!(seen, vec![json!("page-2"), json!("page-3")]);
}
