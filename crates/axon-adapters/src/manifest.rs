//! Manifest item identity helpers.

use axon_api::source::*;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SourceItemIdentity {
    pub source_item_key: SourceItemKey,
    pub canonical_uri: String,
}

pub fn item_identity(
    source_kind: SourceKind,
    source_canonical_uri: &str,
    raw_key: &str,
) -> Result<SourceItemIdentity, ApiError> {
    let source_item_key = normalize_item_key(source_kind, raw_key)?;
    Ok(SourceItemIdentity {
        canonical_uri: join_item_uri(source_canonical_uri, &source_item_key.0),
        source_item_key,
    })
}

fn normalize_item_key(source_kind: SourceKind, raw_key: &str) -> Result<SourceItemKey, ApiError> {
    let trimmed = raw_key.trim();
    if trimmed.is_empty() {
        return Err(ApiError::new(
            "adapter.item_key.invalid",
            axon_error::ErrorStage::Normalizing,
            "source item key must not be empty",
        ));
    }

    let key = if source_kind == SourceKind::Local && trimmed.starts_with('/') {
        public_local_key(trimmed)
    } else {
        trimmed.trim_start_matches('/').to_string()
    };

    if key.is_empty() {
        return Err(ApiError::new(
            "adapter.item_key.invalid",
            axon_error::ErrorStage::Normalizing,
            "source item key must not be empty after normalization",
        ));
    }
    Ok(SourceItemKey::from(key))
}

fn public_local_key(path: &str) -> String {
    for marker in ["/src/", "/crates/", "/apps/", "/docs/", "/tests/"] {
        if let Some((_, suffix)) = path.split_once(marker) {
            return format!("{}{}", marker.trim_start_matches('/'), suffix);
        }
    }
    path.rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or("local-item")
        .to_string()
}

fn join_item_uri(source_canonical_uri: &str, source_item_key: &str) -> String {
    format!(
        "{}/{}",
        source_canonical_uri.trim_end_matches('/'),
        source_item_key.trim_start_matches('/')
    )
}
