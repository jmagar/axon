use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

macro_rules! string_id {
    ($name:ident) => {
        #[derive(
            Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, JsonSchema,
        )]
        pub struct $name(pub String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Self {
                Self(value.into())
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self(value)
            }
        }

        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                Self(value.to_string())
            }
        }
    };
}

macro_rules! uuid_id {
    ($name:ident) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
        pub struct $name(pub Uuid);

        impl $name {
            pub fn new(value: Uuid) -> Self {
                Self(value)
            }
        }

        impl From<Uuid> for $name {
            fn from(value: Uuid) -> Self {
                Self(value)
            }
        }
    };
}

uuid_id!(JobId);
uuid_id!(StageId);
uuid_id!(BatchId);

string_id!(SourceId);
string_id!(SourceItemKey);
string_id!(SourceGenerationId);
string_id!(DocumentId);
string_id!(ChunkId);
string_id!(VectorPointId);
string_id!(ProviderId);
string_id!(ArtifactId);
string_id!(CleanupDebtId);
string_id!(WatchId);
string_id!(MemoryId);
string_id!(GraphNodeId);
string_id!(GraphEdgeId);
string_id!(ConfigSnapshotId);

pub type Timestamp = DateTime<Utc>;
pub type MetadataMap = serde_json::Map<String, serde_json::Value>;
