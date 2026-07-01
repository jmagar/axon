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
    pub adapter_hint: Option<String>,
    pub confidence: f32,
}

impl AuthorityRecord {
    pub fn new(
        authority_id: impl Into<String>,
        canonical_uri: impl Into<String>,
        source_kind: SourceKind,
        authority: AuthorityLevel,
    ) -> Self {
        let canonical_uri = canonical_uri.into();
        Self {
            authority_id: authority_id.into(),
            adapter_hint: adapter_hint_for_uri(&canonical_uri),
            canonical_uri,
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

    pub fn with_adapter_hint(mut self, adapter: impl Into<String>) -> Self {
        self.adapter_hint = Some(adapter.into());
        self
    }

    pub fn with_confidence(mut self, confidence: f32) -> Self {
        self.confidence = confidence.clamp(0.0, 1.0);
        self
    }
}

#[derive(Debug, Clone, Default)]
pub struct InMemoryAuthorityRegistry {
    records: Vec<AuthorityRecord>,
}

fn adapter_hint_for_uri(uri: &str) -> Option<String> {
    let hint = if uri.starts_with("github://") {
        "github"
    } else if uri.starts_with("gitlab://") {
        "gitlab"
    } else if uri.starts_with("gitea://") {
        "gitea"
    } else if uri.starts_with("git+https://") {
        "git"
    } else if let Some(rest) = uri.strip_prefix("pkg://") {
        rest.split('/').next()?
    } else if uri.starts_with("docker://") {
        "docker"
    } else if uri.starts_with("reddit://") {
        "reddit"
    } else if uri.starts_with("youtube://") {
        "youtube"
    } else if uri.starts_with("feed://") {
        "feed"
    } else if uri.starts_with("session://") {
        "session"
    } else if uri.starts_with("local://") {
        "local"
    } else if uri.starts_with("upload://") {
        "upload"
    } else if uri.starts_with("cli://") {
        "cli"
    } else if uri.starts_with("mcp://") {
        "mcp"
    } else if uri.starts_with("http://") || uri.starts_with("https://") {
        "web"
    } else {
        return None;
    };
    Some(hint.to_string())
}

impl InMemoryAuthorityRegistry {
    pub fn from_records(records: Vec<AuthorityRecord>) -> Self {
        Self { records }
    }

    pub fn find(&self, raw_source: &str) -> Option<&AuthorityRecord> {
        self.matches(raw_source).into_iter().next()
    }

    pub fn matches(&self, raw_source: &str) -> Vec<&AuthorityRecord> {
        let alias = normalize_alias(raw_source);
        self.records
            .iter()
            .filter(|record| {
                normalize_alias(&record.canonical_uri) == alias
                    || record.aliases.iter().any(|candidate| candidate == &alias)
            })
            .collect()
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
