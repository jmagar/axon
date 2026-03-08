use crate::crates::cli::commands::doctor::build_doctor_report;
use crate::crates::cli::commands::status::status_full;
use crate::crates::core::config::Config;
use crate::crates::services::events::{LogLevel, ServiceEvent, emit};
use crate::crates::services::types::{
    DedupeResult, DoctorResult, DomainFacet, DomainsResult, Pagination, SourcesResult, StatsResult,
    StatusResult,
};
use crate::crates::vector::ops::qdrant::{domains_payload, run_dedupe_native, sources_payload};
use crate::crates::vector::ops::stats::stats_payload;
use std::error::Error;
use std::fmt;
use tokio::sync::mpsc;

#[derive(Debug)]
pub struct PayloadParseError(String);
impl fmt::Display for PayloadParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "payload parse error: {}", self.0)
    }
}
impl Error for PayloadParseError {}

pub fn map_sources_payload(
    payload: &serde_json::Value,
) -> Result<SourcesResult, PayloadParseError> {
    let count = payload
        .get("count")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| PayloadParseError("missing count".into()))? as usize;
    let limit = payload
        .get("limit")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| PayloadParseError("missing limit".into()))? as usize;
    let offset = payload
        .get("offset")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| PayloadParseError("missing offset".into()))? as usize;
    let urls = payload
        .get("urls")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| PayloadParseError("missing urls".into()))?
        .iter()
        .enumerate()
        .map(|(i, item)| {
            let url = item
                .get("url")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| PayloadParseError(format!("urls[{i}]: missing url")))?
                .to_string();
            let chunks = item
                .get("chunks")
                .and_then(serde_json::Value::as_u64)
                .ok_or_else(|| PayloadParseError(format!("urls[{i}]: missing chunks")))?
                as usize;
            Ok((url, chunks))
        })
        .collect::<Result<Vec<_>, PayloadParseError>>()?;

    Ok(SourcesResult {
        count,
        limit,
        offset,
        urls,
    })
}

pub fn map_domains_payload(
    payload: &serde_json::Value,
) -> Result<DomainsResult, PayloadParseError> {
    let limit = payload
        .get("limit")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| PayloadParseError("missing limit".into()))? as usize;
    let offset = payload
        .get("offset")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| PayloadParseError("missing offset".into()))? as usize;

    let domains = payload
        .get("domains")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| PayloadParseError("missing domains".into()))?
        .iter()
        .enumerate()
        .map(|(i, item)| {
            Ok(DomainFacet {
                domain: item
                    .get("domain")
                    .and_then(serde_json::Value::as_str)
                    .ok_or_else(|| PayloadParseError(format!("domains[{i}]: missing domain")))?
                    .to_string(),
                vectors: item
                    .get("vectors")
                    .and_then(serde_json::Value::as_u64)
                    .ok_or_else(|| PayloadParseError(format!("domains[{i}]: missing vectors")))?
                    as usize,
            })
        })
        .collect::<Result<Vec<_>, PayloadParseError>>()?;

    Ok(DomainsResult {
        domains,
        limit,
        offset,
    })
}

pub fn map_stats_payload(payload: serde_json::Value) -> StatsResult {
    StatsResult { payload }
}

pub fn map_doctor_payload(payload: serde_json::Value) -> DoctorResult {
    DoctorResult { payload }
}

pub async fn sources(
    cfg: &Config,
    pagination: Pagination,
) -> Result<SourcesResult, Box<dyn Error>> {
    let payload = sources_payload(cfg, pagination.limit, pagination.offset).await?;
    Ok(map_sources_payload(&payload)?)
}

pub async fn domains(
    cfg: &Config,
    pagination: Pagination,
) -> Result<DomainsResult, Box<dyn Error>> {
    let payload = domains_payload(cfg, pagination.limit, pagination.offset).await?;
    Ok(map_domains_payload(&payload)?)
}

pub async fn stats(cfg: &Config) -> Result<StatsResult, Box<dyn Error>> {
    let payload = stats_payload(cfg).await?;
    Ok(map_stats_payload(payload))
}

pub async fn doctor(cfg: &Config) -> Result<DoctorResult, Box<dyn Error>> {
    let payload = build_doctor_report(cfg).await?;
    Ok(map_doctor_payload(payload))
}

pub async fn full_status(cfg: &Config) -> Result<StatusResult, Box<dyn Error>> {
    let (payload, text) = status_full(cfg).await?;
    Ok(StatusResult { payload, text })
}

pub async fn dedupe(
    cfg: &Config,
    tx: Option<mpsc::Sender<ServiceEvent>>,
) -> Result<DedupeResult, Box<dyn Error>> {
    emit(
        &tx,
        ServiceEvent::Log {
            level: LogLevel::Info,
            message: "starting dedupe".to_string(),
        },
    );
    if let Err(e) = run_dedupe_native(cfg).await {
        emit(
            &tx,
            ServiceEvent::Log {
                level: LogLevel::Error,
                message: format!("dedupe failed: {e}"),
            },
        );
        return Err(e);
    }
    emit(
        &tx,
        ServiceEvent::Log {
            level: LogLevel::Info,
            message: "completed dedupe".to_string(),
        },
    );
    Ok(DedupeResult { completed: true })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ── map_sources_payload ───────────────────────────────────────────────────

    #[test]
    fn map_sources_valid() {
        let payload = json!({
            "count": 2,
            "limit": 10,
            "offset": 0,
            "urls": [
                { "url": "https://example.com/a", "chunks": 3 },
                { "url": "https://example.com/b", "chunks": 7 }
            ]
        });
        let result = map_sources_payload(&payload).unwrap();
        assert_eq!(result.count, 2);
        assert_eq!(result.limit, 10);
        assert_eq!(result.offset, 0);
        assert_eq!(result.urls.len(), 2);
        assert_eq!(result.urls[0], ("https://example.com/a".to_string(), 3));
        assert_eq!(result.urls[1], ("https://example.com/b".to_string(), 7));
    }

    #[test]
    fn map_sources_missing_count() {
        let payload = json!({ "limit": 10, "offset": 0, "urls": [] });
        let err = map_sources_payload(&payload).unwrap_err();
        assert!(
            err.to_string().contains("count"),
            "error must mention 'count', got: {err}"
        );
    }

    #[test]
    fn map_sources_missing_urls() {
        let payload = json!({ "count": 0, "limit": 10, "offset": 0 });
        let err = map_sources_payload(&payload).unwrap_err();
        assert!(
            err.to_string().contains("urls"),
            "error must mention 'urls', got: {err}"
        );
    }

    #[test]
    fn map_sources_url_entry_missing_url_field() {
        let payload = json!({
            "count": 1,
            "limit": 10,
            "offset": 0,
            "urls": [{ "chunks": 5 }]
        });
        let err = map_sources_payload(&payload).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("urls[0]"),
            "error must reference urls[0], got: {msg}"
        );
    }

    #[test]
    fn map_sources_url_entry_missing_chunks_field() {
        let payload = json!({
            "count": 1,
            "limit": 10,
            "offset": 0,
            "urls": [{ "url": "https://example.com" }]
        });
        let err = map_sources_payload(&payload).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("chunks"),
            "error must mention 'chunks', got: {msg}"
        );
    }

    #[test]
    fn map_sources_empty_urls_array() {
        let payload = json!({ "count": 0, "limit": 50, "offset": 0, "urls": [] });
        let result = map_sources_payload(&payload).unwrap();
        assert_eq!(result.count, 0);
        assert!(result.urls.is_empty());
    }

    // ── map_domains_payload ───────────────────────────────────────────────────

    #[test]
    fn map_domains_valid() {
        let payload = json!({
            "limit": 20,
            "offset": 5,
            "domains": [
                { "domain": "example.com", "vectors": 42 },
                { "domain": "docs.rs", "vectors": 100 }
            ]
        });
        let result = map_domains_payload(&payload).unwrap();
        assert_eq!(result.limit, 20);
        assert_eq!(result.offset, 5);
        assert_eq!(result.domains.len(), 2);
        assert_eq!(result.domains[0].domain, "example.com");
        assert_eq!(result.domains[0].vectors, 42);
        assert_eq!(result.domains[1].domain, "docs.rs");
        assert_eq!(result.domains[1].vectors, 100);
    }

    #[test]
    fn map_domains_missing_domains_field() {
        let payload = json!({ "limit": 10, "offset": 0 });
        let err = map_domains_payload(&payload).unwrap_err();
        assert!(
            err.to_string().contains("domains"),
            "error must mention 'domains', got: {err}"
        );
    }

    #[test]
    fn map_domains_entry_missing_domain_key() {
        let payload = json!({
            "limit": 10,
            "offset": 0,
            "domains": [{ "vectors": 5 }]
        });
        let err = map_domains_payload(&payload).unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("domains[0]"),
            "error must reference domains[0], got: {msg}"
        );
    }

    #[test]
    fn map_domains_empty() {
        let payload = json!({ "limit": 10, "offset": 0, "domains": [] });
        let result = map_domains_payload(&payload).unwrap();
        assert!(result.domains.is_empty());
        assert_eq!(result.limit, 10);
        assert_eq!(result.offset, 0);
    }
}
