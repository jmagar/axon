//! Qdrant target boundary shell and conversion helpers.

use std::collections::HashMap;

use async_trait::async_trait;
use axon_api::source::*;
use qdrant_client::qdrant::{
    CreateCollection, CreateFieldIndexCollection, DenseVector, FieldCondition, FieldType, Filter,
    HnswConfigDiff, Match, NamedVectors, OptimizersConfigDiff, PointStruct, QuantizationConfig,
    QuantizationType, ScalarQuantization, SparseVector as QdrantSparseVector,
    SparseVectorConfig as QdrantSparseVectorConfig, SparseVectorParams, Value,
    Vector as QdrantVector, VectorParams, VectorParamsMap, Vectors, VectorsConfig, condition,
    r#match, quantization_config, vector, vectors, vectors_config,
};

use crate::payload::VectorPayload;
use crate::sparse::{batch_sparse_vectors_by_chunk, validate_sparse_vector};
use crate::store::{Result, VectorStore};

#[allow(dead_code)]
pub const MODULE_NAME: &str = "qdrant";

#[allow(dead_code)]
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

    #[allow(dead_code)]
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
        .with_context("endpoint", "configured")
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
    let settings = QdrantCollectionSettings::default();
    let mut dense = HashMap::new();
    dense.insert(
        spec.dense.name.clone(),
        VectorParams {
            size: u64::from(spec.dense.dimensions),
            distance: qdrant_distance(spec.dense.distance) as i32,
            hnsw_config: None,
            quantization_config: None,
            on_disk: Some(settings.dense_on_disk),
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
        hnsw_config: Some(HnswConfigDiff {
            m: Some(settings.hnsw_m),
            ef_construct: Some(settings.hnsw_ef_construct),
            full_scan_threshold: None,
            max_indexing_threads: None,
            on_disk: Some(settings.hnsw_on_disk),
            payload_m: None,
            inline_storage: None,
        }),
        wal_config: None,
        optimizers_config: Some(OptimizersConfigDiff {
            deleted_threshold: None,
            vacuum_min_vector_number: None,
            default_segment_number: None,
            max_segment_size: None,
            memmap_threshold: None,
            indexing_threshold: Some(settings.indexing_threshold),
            flush_interval_sec: None,
            deprecated_max_optimization_threads: None,
            max_optimization_threads: None,
            prevent_unoptimized: None,
        }),
        shard_number: None,
        on_disk_payload: None,
        timeout: None,
        replication_factor: None,
        write_consistency_factor: None,
        quantization_config: Some(QuantizationConfig {
            quantization: Some(quantization_config::Quantization::Scalar(
                ScalarQuantization {
                    r#type: QuantizationType::Int8 as i32,
                    quantile: Some(settings.quantization_quantile),
                    always_ram: Some(settings.quantization_always_ram),
                },
            )),
        }),
        sharding_method: None,
        strict_mode_config: None,
        metadata: HashMap::new(),
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct QdrantCollectionSettings {
    pub dense_on_disk: bool,
    pub hnsw_m: u64,
    pub hnsw_ef_construct: u64,
    pub hnsw_on_disk: bool,
    pub indexing_threshold: u64,
    pub quantization_quantile: f32,
    pub quantization_always_ram: bool,
}

impl Default for QdrantCollectionSettings {
    fn default() -> Self {
        Self {
            dense_on_disk: true,
            hnsw_m: 32,
            hnsw_ef_construct: 256,
            hnsw_on_disk: false,
            indexing_threshold: 20_000,
            quantization_quantile: 0.99,
            quantization_always_ram: true,
        }
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

pub fn qdrant_filter(request: &VectorSearchRequest) -> Result<Option<Filter>> {
    let mut conditions = Vec::new();
    for (field, value) in request.filters.iter() {
        conditions.extend(field_conditions(field, value)?);
    }
    if let Some(generation) = &request.generation {
        let value = serde_json::Value::from(generation.0.clone());
        conditions.push(field_condition("source_generation", &value));
    }
    Ok((!conditions.is_empty()).then_some(Filter {
        should: Vec::new(),
        must: conditions,
        must_not: Vec::new(),
        min_should: None,
    }))
}

pub fn qdrant_upsert_points(
    spec: &CollectionSpec,
    batch: &VectorPointBatch,
) -> Result<Vec<PointStruct>> {
    if (batch.sparse_vectors.is_some()
        || batch
            .points
            .iter()
            .any(|point| point.sparse_vector.is_some()))
        && spec.sparse.is_none()
    {
        return Err(ApiError::new(
            "vector.sparse_not_configured",
            axon_error::ErrorStage::Upserting,
            format!(
                "collection {} does not declare a sparse vector namespace",
                batch.collection
            ),
        ));
    }
    let batch_sparse = batch_sparse_vectors_by_chunk(batch, axon_error::ErrorStage::Upserting)?;
    batch
        .points
        .iter()
        .map(|point| {
            let mut named = HashMap::new();
            named.insert(
                spec.dense.name.clone(),
                qdrant_dense_vector(point.vector.clone()),
            );
            let sparse_vector = point
                .sparse_vector
                .as_ref()
                .or_else(|| batch_sparse.get(&point.chunk_id.0));
            if let (Some(sparse_spec), Some(sparse_vector)) = (spec.sparse.as_ref(), sparse_vector)
            {
                validate_sparse_vector(
                    &point.chunk_id,
                    sparse_vector,
                    axon_error::ErrorStage::Upserting,
                )?;
                named.insert(
                    sparse_spec.name.clone(),
                    qdrant_sparse_vector(
                        sparse_vector.indices.clone(),
                        sparse_vector.values.clone(),
                    ),
                );
            }
            if point.vector.len() as u32 != spec.dense.dimensions {
                return Err(ApiError::new(
                    "vector.dimension_mismatch",
                    axon_error::ErrorStage::Upserting,
                    format!(
                        "point {} dimensions {} do not match collection dimensions {}",
                        point.point_id.0,
                        point.vector.len(),
                        spec.dense.dimensions
                    ),
                ));
            }
            VectorPayload::try_from_metadata(point.payload.clone()).map_err(|err| {
                ApiError::new(
                    "vector.invalid_payload",
                    axon_error::ErrorStage::Upserting,
                    err.to_string(),
                )
            })?;
            Ok(PointStruct {
                id: Some(point.point_id.0.as_str().into()),
                payload: point
                    .payload
                    .iter()
                    .map(|(field, value)| (field.clone(), json_to_qdrant_value(value)))
                    .collect(),
                vectors: Some(Vectors {
                    vectors_options: Some(vectors::VectorsOptions::Vectors(NamedVectors {
                        vectors: named,
                    })),
                }),
            })
        })
        .collect()
}

#[allow(deprecated)]
fn qdrant_dense_vector(data: Vec<f32>) -> QdrantVector {
    QdrantVector {
        data: Vec::new(),
        indices: None,
        vectors_count: None,
        vector: Some(vector::Vector::Dense(DenseVector { data })),
    }
}

#[allow(deprecated)]
fn qdrant_sparse_vector(indices: Vec<u32>, values: Vec<f32>) -> QdrantVector {
    QdrantVector {
        data: Vec::new(),
        indices: None,
        vectors_count: None,
        vector: Some(vector::Vector::Sparse(QdrantSparseVector {
            indices,
            values,
        })),
    }
}

fn field_conditions(
    field: &str,
    value: &serde_json::Value,
) -> Result<Vec<qdrant_client::qdrant::Condition>> {
    validate_filter_value(field, value)?;
    let Some(values) = value.as_array() else {
        return Ok(vec![field_condition(field, value)]);
    };
    if values.is_empty() {
        return Ok(vec![field_condition(
            "__axon_match_none",
            &serde_json::json!("__never__"),
        )]);
    }
    if values.len() == 1 {
        return Ok(vec![field_condition(field, &values[0])]);
    }
    Ok(vec![qdrant_client::qdrant::Condition {
        condition_one_of: Some(condition::ConditionOneOf::Filter(Filter {
            should: values
                .iter()
                .map(|value| field_condition(field, value))
                .collect(),
            must: Vec::new(),
            must_not: Vec::new(),
            min_should: None,
        })),
    }])
}

fn validate_filter_value(field: &str, value: &serde_json::Value) -> Result<()> {
    match value {
        serde_json::Value::String(_)
        | serde_json::Value::Number(_)
        | serde_json::Value::Bool(_) => Ok(()),
        serde_json::Value::Array(values) => {
            for value in values {
                validate_filter_value(field, value)?;
            }
            Ok(())
        }
        other => Err(ApiError::new(
            "vector.invalid_filter_value",
            axon_error::ErrorStage::Retrieving,
            format!(
                "filter field {field} must be a scalar or array of scalars, got {}",
                filter_value_kind(other)
            ),
        )),
    }
}

fn filter_value_kind(value: &serde_json::Value) -> &'static str {
    match value {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "boolean",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::String(_) => "string",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "object",
    }
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
