//! Authority and alias records used during source resolution.

use axon_api::{AuthorityLevel, SourceKind, SourceScope};

#[derive(Debug, Clone, PartialEq)]
pub struct AuthorityRecord {
    pub authority_id: String,
    pub canonical_uri: String,
    pub source_kind: SourceKind,
    pub authority: AuthorityLevel,
    pub aliases: Vec<String>,
    pub entrypoints: Vec<(SourceScope, String)>,
    pub confidence: f32,
}

impl AuthorityRecord {
    pub fn new(
        authority_id: impl Into<String>,
        canonical_uri: impl Into<String>,
        source_kind: SourceKind,
        authority: AuthorityLevel,
    ) -> Self {
        Self {
            authority_id: authority_id.into(),
            canonical_uri: canonical_uri.into(),
            source_kind,
            authority,
            aliases: Vec::new(),
            entrypoints: Vec::new(),
            confidence: 1.0,
        }
    }

    pub fn with_alias(mut self, alias: impl Into<String>) -> Self {
        self.aliases.push(normalize_alias(&alias.into()));
        self
    }

    pub fn with_entrypoint(mut self, scope: SourceScope, uri: impl Into<String>) -> Self {
        self.entrypoints.push((scope, uri.into()));
        self
    }
}

#[derive(Debug, Clone, Default)]
pub struct InMemoryAuthorityRegistry {
    records: Vec<AuthorityRecord>,
}

impl InMemoryAuthorityRegistry {
    pub fn from_records(records: Vec<AuthorityRecord>) -> Self {
        Self { records }
    }

    pub fn find(&self, raw_source: &str) -> Option<&AuthorityRecord> {
        let alias = normalize_alias(raw_source);
        self.records.iter().find(|record| {
            normalize_alias(&record.canonical_uri) == alias
                || record.aliases.iter().any(|candidate| candidate == &alias)
        })
    }
}

fn normalize_alias(value: &str) -> String {
    value
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/')
        .to_ascii_lowercase()
}
