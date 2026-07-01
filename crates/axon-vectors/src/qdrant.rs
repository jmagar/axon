//! Qdrant target boundary shell and conversion helpers.

use std::collections::HashMap;

use async_trait::async_trait;
use axon_api::source::*;
use qdrant_client::qdrant::{
    CreateCollection, CreateFieldIndexCollection, FieldCondition, FieldType, Filter, Match,
    PointStruct, SparseVectorConfig as QdrantSparseVectorConfig, SparseVectorParams, Value,
    VectorParams, VectorParamsMap, Vectors, VectorsConfig, condition, r#match, vectors_config,
};

use crate::store::{Result, VectorStore};

pub const MODULE_NAME: &str = "qdrant";

#[derive(Debug, Clone)]
pub struct QdrantVectorStore {
    url: String,
    provider_id: ProviderId,
}

impl QdrantVectorStore {
    pub fn new(url: impl Into<String>, provider_id: impl Into<String>) -> Self {
        Self {
            url: url.into(),
            provider_id: ProviderId::new(provider_id),
        }
    }

    pub fn url(&self) -> &str {
        &self.url
    }

    fn not_wired(&self, stage: axon_error::ErrorStage) -> ApiError {
        ApiError::new(
            "vector.not_wired",
            stage,
            "target Qdrant vector store is not wired to the live runtime yet",
        )
        .with_provider_id(&self.provider_id.0)
        .with_context("url", self.url.clone())
    }
}

#[async_trait]
impl VectorStore for QdrantVectorStore {
    async fn ensure_collection(&self, _spec: CollectionSpec) -> Result<()> {
        Err(self.not_wired(axon_error::ErrorStage::Upserting))
    }

    async fn upsert(&self, _batch: VectorPointBatch) -> Result<VectorStoreWriteResult> {
        Err(self.not_wired(axon_error::ErrorStage::Upserting))
    }

    async fn delete(&self, _selector: VectorDeleteSelector) -> Result<VectorStoreDeleteResult> {
        Err(self.not_wired(axon_error::ErrorStage::Cleaning))
    }

    async fn search(&self, _request: VectorSearchRequest) -> Result<VectorSearchResult> {
        Err(self.not_wired(axon_error::ErrorStage::Retrieving))
    }

    async fn reset(&self) -> Result<()> {
        Err(self.not_wired(axon_error::ErrorStage::Cleaning))
    }

    async fn capabilities(&self) -> Result<ProviderCapability> {
        Ok(ProviderCapability {
            provider_id: self.provider_id.clone(),
            provider_kind: ProviderKind::Vector,
            implementation: "qdrant-target-shell".to_string(),
            version: env!("CARGO_PKG_VERSION").to_string(),
            health: HealthStatus::Unavailable,
            limits: ProviderLimits::default(),
            features: vec![
                "dense".to_string(),
                "sparse".to_string(),
                "payload_filters".to_string(),
                "payload_indexes".to_string(),
            ],
            cooldown_until: None,
            last_error: Some(self.not_wired(axon_error::ErrorStage::Observing)),
            reservation_policy: ReservationPolicy {
                supports_reservations: false,
                queue_policy: QueuePolicy::Fifo,
                interactive_reserve: 0,
                cooldown_after_failures: 1,
                cooldown_secs: 30,
                retry_backoff_ms: None,
            },
            reservation_state: ReservationStateSnapshot {
                queued: 0,
                active: 0,
                available_units: 0,
                oldest_queued_ms: None,
                priority_breakdown: Default::default(),
                states: vec![ReservationState::Failed],
            },
            cost_class: ProviderCostClass::Internal,
            degraded_modes: Vec::new(),
            fake_overrides_supported: false,
            embedding: None,
            llm: None,
            vector_store: Some(VectorStoreCapability {
                dense: true,
                sparse: true,
                hybrid: true,
                payload_filters: true,
                payload_indexes: Vec::new(),
                delete_by_filter: true,
                collection_aliases: true,
                consistency: VectorConsistency::Strong,
            }),
            fetch: None,
            render: None,
            credential: None,
        })
    }
}

pub fn qdrant_collection_request(spec: &CollectionSpec) -> CreateCollection {
    let mut dense = HashMap::new();
    dense.insert(
        spec.dense.name.clone(),
        VectorParams {
            size: u64::from(spec.dense.dimensions),
            distance: qdrant_distance(spec.dense.distance) as i32,
            hnsw_config: None,
            quantization_config: None,
            on_disk: None,
            datatype: None,
            multivector_config: None,
        },
    );

    CreateCollection {
        collection_name: spec.collection.clone(),
        vectors_config: Some(VectorsConfig {
            config: Some(vectors_config::Config::ParamsMap(VectorParamsMap {
                map: dense,
            })),
        }),
        sparse_vectors_config: spec.sparse.as_ref().map(|sparse| {
            let mut map = HashMap::new();
            map.insert(
                sparse.name.clone(),
                SparseVectorParams {
                    index: None,
                    modifier: Some(qdrant_sparse_modifier(sparse.modifier) as i32),
                },
            );
            QdrantSparseVectorConfig { map }
        }),
        hnsw_config: None,
        wal_config: None,
        optimizers_config: None,
        shard_number: None,
        on_disk_payload: None,
        timeout: None,
        replication_factor: None,
        write_consistency_factor: None,
        quantization_config: None,
        sharding_method: None,
        strict_mode_config: None,
        metadata: HashMap::new(),
    }
}

pub fn qdrant_payload_index_requests(spec: &CollectionSpec) -> Vec<CreateFieldIndexCollection> {
    spec.payload_indexes
        .iter()
        .map(|index| CreateFieldIndexCollection {
            collection_name: spec.collection.clone(),
            wait: Some(true),
            field_name: index.field_name.clone(),
            field_type: Some(qdrant_field_type(index.field_schema.clone()) as i32),
            field_index_params: None,
            ordering: None,
            timeout: None,
        })
        .collect()
}

pub fn qdrant_filter(request: &VectorSearchRequest) -> Option<Filter> {
    let mut conditions = request
        .filters
        .iter()
        .flat_map(|(field, value)| field_conditions(field, value))
        .collect::<Vec<_>>();
    if let Some(generation) = &request.generation {
        let value = generation
            .0
            .parse::<i64>()
            .map(serde_json::Value::from)
            .unwrap_or_else(|_| serde_json::Value::String(generation.0.clone()));
        conditions.push(field_condition("source_generation", &value));
    }
    (!conditions.is_empty()).then_some(Filter {
        should: Vec::new(),
        must: conditions,
        must_not: Vec::new(),
        min_should: None,
    })
}

pub fn qdrant_upsert_points(spec: &CollectionSpec, batch: &VectorPointBatch) -> Vec<PointStruct> {
    batch
        .points
        .iter()
        .map(|point| {
            let mut named = HashMap::new();
            named.insert(spec.dense.name.clone(), point.vector.clone());
            PointStruct {
                id: Some(point.point_id.0.as_str().into()),
                payload: point
                    .payload
                    .iter()
                    .map(|(field, value)| (field.clone(), json_to_qdrant_value(value)))
                    .collect(),
                vectors: Some(Vectors::from(named)),
            }
        })
        .collect()
}

fn field_conditions(
    field: &str,
    value: &serde_json::Value,
) -> Vec<qdrant_client::qdrant::Condition> {
    let Some(values) = value.as_array() else {
        return vec![field_condition(field, value)];
    };
    if values.len() == 1 {
        return vec![field_condition(field, &values[0])];
    }
    vec![qdrant_client::qdrant::Condition {
        condition_one_of: Some(condition::ConditionOneOf::Filter(Filter {
            should: values
                .iter()
                .map(|value| field_condition(field, value))
                .collect(),
            must: Vec::new(),
            must_not: Vec::new(),
            min_should: None,
        })),
    }]
}

fn field_condition(field: &str, value: &serde_json::Value) -> qdrant_client::qdrant::Condition {
    qdrant_client::qdrant::Condition {
        condition_one_of: Some(condition::ConditionOneOf::Field(FieldCondition {
            key: field.to_string(),
            r#match: Some(Match {
                match_value: Some(qdrant_match_value(value)),
            }),
            range: None,
            geo_bounding_box: None,
            geo_radius: None,
            values_count: None,
            geo_polygon: None,
            datetime_range: None,
            is_empty: None,
            is_null: None,
        })),
    }
}

fn qdrant_match_value(value: &serde_json::Value) -> r#match::MatchValue {
    if let Some(value) = value.as_i64() {
        return r#match::MatchValue::Integer(value);
    }
    if let Some(value) = value.as_bool() {
        return r#match::MatchValue::Boolean(value);
    }
    r#match::MatchValue::Keyword(match value {
        serde_json::Value::String(value) => value.clone(),
        other => other.to_string(),
    })
}

fn json_to_qdrant_value(value: &serde_json::Value) -> Value {
    serde_json::from_value(value.clone()).unwrap_or_else(|_| Value {
        kind: Some(qdrant_client::qdrant::value::Kind::StringValue(
            value.to_string(),
        )),
    })
}

fn qdrant_distance(distance: VectorDistance) -> qdrant_client::qdrant::Distance {
    match distance {
        VectorDistance::Cosine => qdrant_client::qdrant::Distance::Cosine,
        VectorDistance::Dot => qdrant_client::qdrant::Distance::Dot,
        VectorDistance::Euclid => qdrant_client::qdrant::Distance::Euclid,
        VectorDistance::Manhattan => qdrant_client::qdrant::Distance::Manhattan,
    }
}

fn qdrant_sparse_modifier(modifier: SparseVectorModifier) -> qdrant_client::qdrant::Modifier {
    match modifier {
        SparseVectorModifier::None => qdrant_client::qdrant::Modifier::None,
        SparseVectorModifier::Idf => qdrant_client::qdrant::Modifier::Idf,
    }
}

fn qdrant_field_type(schema: PayloadFieldSchema) -> FieldType {
    match schema {
        PayloadFieldSchema::Keyword => FieldType::Keyword,
        PayloadFieldSchema::Integer => FieldType::Integer,
        PayloadFieldSchema::Float => FieldType::Float,
        PayloadFieldSchema::Boolean => FieldType::Bool,
        PayloadFieldSchema::Datetime => FieldType::Datetime,
        PayloadFieldSchema::Text => FieldType::Text,
    }
}
