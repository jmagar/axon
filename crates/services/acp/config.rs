//! ACP adapter configuration directory discovery and model reading.

use crate::crates::services::types::{AcpConfigOption, AcpConfigSelectValue};
use std::path::PathBuf;

use super::adapters::{CodexCachedModel, CodexModelsCache, normalized_requested_model};

// ── Config directory discovery ──────────────────────────────────────────────

pub(super) fn codex_config_dir() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .filter(|v| !v.is_empty()) // ignore HOME="" — would resolve config relative to cwd
        .map(PathBuf::from)
        .map(|home| home.join(".codex"))
}

pub(super) fn gemini_config_dir() -> Option<PathBuf> {
    std::env::var_os("GEMINI_CLI_HOME")
        .filter(|v| !v.is_empty()) // ignore empty GEMINI_CLI_HOME — same cwd hazard
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .filter(|v| !v.is_empty())
                .map(|h| PathBuf::from(h).join(".gemini"))
        })
}

// ── Default model readers ───────────────────────────────────────────────────

/// Read the default model from a Codex `config.toml`.
///
/// FIX L-5: Uses the `toml` crate for proper TOML parsing instead of naive
/// line-by-line scanning that could match commented-out or nested keys.
pub(super) async fn read_codex_default_model() -> Option<String> {
    let config_path = codex_config_dir()?.join("config.toml");
    let content = tokio::fs::read_to_string(config_path).await.ok()?;
    let value: toml::Value = content.parse().ok()?;
    value
        .get("model")?
        .as_str()
        .filter(|s| !s.is_empty())
        .map(String::from)
}

pub(super) async fn read_gemini_default_model() -> Option<String> {
    let config_path = gemini_config_dir()?.join("settings.json");
    let raw = tokio::fs::read_to_string(config_path).await.ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    parsed
        .pointer("/model/name")
        .or_else(|| parsed.get("selectedModel"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
}

// ── Cached model option builders ────────────────────────────────────────────

pub(super) async fn read_gemini_cached_model_options(
    current_model: Option<&str>,
) -> Option<Vec<AcpConfigOption>> {
    // Use if-let rather than `.or()` to avoid eagerly awaiting the fallback
    // when the normalized model is already known.
    let model = if let Some(m) = current_model.and_then(|v| normalized_requested_model(Some(v))) {
        m
    } else {
        read_gemini_default_model().await?
    };
    Some(vec![AcpConfigOption {
        id: "model".to_string(),
        name: "Model".to_string(),
        description: Some("Gemini model".to_string()),
        category: Some("model".to_string()),
        current_value: model.clone(),
        options: vec![AcpConfigSelectValue {
            value: model.clone(),
            name: model,
            description: None,
        }],
    }])
}

pub(super) async fn read_codex_cached_model_options(
    current_model: Option<&str>,
) -> Option<Vec<AcpConfigOption>> {
    let cache_path = codex_config_dir()?.join("models_cache.json");
    let raw = tokio::fs::read_to_string(cache_path).await.ok()?;
    let cache: CodexModelsCache = serde_json::from_str(&raw).ok()?;
    if cache.models.is_empty() {
        return None;
    }
    let options = cache
        .models
        .into_iter()
        .map(|model: CodexCachedModel| AcpConfigSelectValue {
            value: model.slug.clone(),
            name: model.display_name.unwrap_or_else(|| model.slug.clone()),
            description: model.description,
        })
        .collect::<Vec<_>>();
    // Use if-let rather than `.or()` to avoid eagerly awaiting the fallback
    // when the normalized model is already known.
    let selected = if let Some(m) = current_model.and_then(|v| normalized_requested_model(Some(v)))
    {
        m
    } else if let Some(m) = read_codex_default_model().await {
        m
    } else {
        options.first().map(|option| option.value.clone())?
    };
    Some(vec![AcpConfigOption {
        id: "model".to_string(),
        name: "Model".to_string(),
        description: Some("Codex cached model choices".to_string()),
        category: Some("model".to_string()),
        current_value: selected,
        options,
    }])
}
