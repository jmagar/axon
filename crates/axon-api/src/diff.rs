//! Transport-neutral diff result DTOs.
//!
//! Shared by the `services::diff` compute path, the HTTP `/v1/diff` route, and
//! the jobs watch scheduler's change detector. Living here lets `axon-jobs`
//! consume them without depending on `axon-services`.

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DiffStatus {
    Same,
    Changed,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct MetadataChange {
    pub field: String,
    pub old: Option<String>,
    pub new: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct LinkEntry {
    pub href: String,
    pub text: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct DiffResult {
    pub url_a: String,
    pub url_b: String,
    pub status: DiffStatus,
    /// Unified diff of the markdown content, if any changes.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_diff: Option<String>,
    pub metadata_changes: Vec<MetadataChange>,
    pub links_added: Vec<LinkEntry>,
    pub links_removed: Vec<LinkEntry>,
    pub word_count_delta: i64,
}
