//! Source resolver boundary.

use axon_api::{
    AdapterCandidate, AuthorityLevel, ResolvedSource, Severity, SourceRequest, SourceScope,
    SourceWarning,
};
use axon_error::{ApiError, ErrorStage};

use crate::authority::InMemoryAuthorityRegistry;
use crate::canonical;
use crate::capability::AdapterRegistry;
use crate::source_id::source_id;

#[derive(Debug, Clone)]
pub struct SourceResolver {
    authorities: InMemoryAuthorityRegistry,
    adapters: AdapterRegistry,
}

impl SourceResolver {
    pub fn new(authorities: InMemoryAuthorityRegistry, adapters: AdapterRegistry) -> Self {
        Self {
            authorities,
            adapters,
        }
    }

    pub fn resolve(&self, request: &SourceRequest) -> Result<ResolvedSource, ApiError> {
        let mut warnings = Vec::new();
        let canonical = match self.authorities.find(&request.source) {
            Some(record) => {
                let scope = request.scope.unwrap_or(SourceScope::Docs);
                let canonical_uri = record
                    .entrypoints
                    .iter()
                    .find(|(candidate_scope, _)| candidate_scope == &scope)
                    .map(|(_, uri)| uri.clone())
                    .unwrap_or_else(|| record.canonical_uri.clone());
                warnings.push(warning(
                    "authority.entrypoint_mapped",
                    "source matched an authority entrypoint",
                ));
                canonical::CanonicalSource {
                    canonical_uri,
                    source_kind: record.source_kind,
                    default_scope: scope,
                    adapter_hint: None,
                    display_name: request.source.clone(),
                    reason: format!("matched authority {}", record.authority_id),
                }
            }
            None => canonical::canonicalize(&request.source, request.scope).ok_or_else(|| {
                ApiError::new(
                    "source.resolve.unsupported",
                    ErrorStage::Resolving,
                    "unsupported source input",
                )
                .with_context("source", request.source.clone())
            })?,
        };

        let mut candidates = self
            .adapters
            .adapters_for(canonical.source_kind)
            .into_iter()
            .map(|adapter| AdapterCandidate {
                adapter: adapter.adapter.clone(),
                supported_scopes: adapter.supported_scopes.clone(),
                confidence: if Some(adapter.adapter.name.as_str())
                    == canonical.adapter_hint.as_deref()
                {
                    1.0
                } else {
                    0.8
                },
                reason: format!("{} adapter supports source kind", adapter.adapter.name),
            })
            .collect::<Vec<_>>();
        candidates.sort_by(|left, right| {
            right
                .confidence
                .total_cmp(&left.confidence)
                .then_with(|| left.adapter.name.cmp(&right.adapter.name))
        });

        let authority = self
            .authorities
            .find(&request.source)
            .map(|record| record.authority)
            .unwrap_or(AuthorityLevel::Inferred);
        let confidence = if authority == AuthorityLevel::Official {
            0.95
        } else {
            0.75
        };

        Ok(ResolvedSource {
            requested_uri: request.source.clone(),
            canonical_uri: canonical.canonical_uri.clone(),
            source_id: source_id(canonical.source_kind, &canonical.canonical_uri),
            source_kind: canonical.source_kind,
            display_name: canonical.display_name,
            candidate_adapters: candidates.clone(),
            default_scope: request.scope.unwrap_or(canonical.default_scope),
            available_scopes: candidates
                .first()
                .map(|candidate| candidate.supported_scopes.clone())
                .unwrap_or_default(),
            authority,
            confidence,
            reason: canonical.reason,
            warnings,
        })
    }
}

fn warning(code: &str, message: &str) -> SourceWarning {
    SourceWarning {
        code: code.to_string(),
        severity: Severity::Info,
        message: message.to_string(),
        source_item_key: None,
        retryable: false,
    }
}
