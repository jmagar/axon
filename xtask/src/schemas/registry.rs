use anyhow::{Result, bail};

use super::artifact::SchemaArtifact;

pub const REMOVED_SURFACE_TOKENS: &[&str] = &[
    "\"EmbedRequest\"",
    "\"IngestRequest\"",
    "\"CrawlRequest\"",
    "\"ScrapeRequest\"",
    "\"PurgeRequest\"",
    "\"CodeSearchRequest\"",
    "\"code-search-watch\"",
    "\"code-search\"",
    "\"purge\"",
    "\"dedupe\"",
    "\"axon refresh\"",
    "\"fresh\"",
    "\"/v1/embed\"",
    "\"/v1/ingest\"",
    "\"/v1/scrape\"",
    "\"/v1/crawl\"",
    "\"/v1/purge\"",
    "\"/v1/dedupe\"",
    "\"/v1/watch/{id}/run\"",
    "\"action=embed\"",
    "\"action=ingest\"",
    "\"action=scrape\"",
    "\"action=crawl\"",
    "\"action=code_search\"",
    "\"action=vertical_scrape\"",
    "\"action=purge\"",
    "\"action=dedupe\"",
    "\"AXON_MCP_HTTP_HOST\"",
    "\"AXON_MCP_HTTP_PORT\"",
    "\"AXON_MCP_HTTP_TOKEN\"",
    "\"AXON_MCP_AUTH_MODE\"",
    "\"AXON_MCP_PUBLIC_URL\"",
    "\"AXON_MCP_GOOGLE_CLIENT_ID\"",
    "\"AXON_MCP_GOOGLE_CLIENT_SECRET\"",
    "\"AXON_MCP_AUTH_ADMIN_EMAIL\"",
    "\"AXON_MCP_AUTH_ALLOWED_REDIRECT_URIS\"",
    "\"AXON_MCP_ALLOWED_ORIGINS\"",
    "\"AXON_COLLECTION\"",
    "\"AXON_HYBRID_CANDIDATES\"",
    "\"AXON_ASK_HYBRID_CANDIDATES\"",
    "\"AXON_INGEST_LANES\"",
    "\"AXON_EMBED_DOC_TIMEOUT_SECS\"",
    "\"AXON_WATCH_TICK_SECS\"",
    "\"AXON_WATCH_LEASE_SECS\"",
    "\"input\"",
    "\"source_type\"",
    "\"target\"",
    "\"include_source\"",
    "\"urls\"",
    "\"prefix\"",
    "\"cwd\"",
    "\"path_prefix\"",
    "\"no_freshness\"",
];

pub const CANONICAL_ENUMS: &[(&str, &[&str])] = &[
    ("SourceIntent", &["acquire", "refresh", "watch", "map"]),
    (
        "SourceKind",
        &[
            "web", "local", "git", "registry", "feed", "reddit", "youtube", "session", "cli_tool",
            "mcp_tool", "memory", "upload",
        ],
    ),
    (
        "PipelinePhase",
        &[
            "queued",
            "requested",
            "resolving",
            "routing",
            "authorizing",
            "planning",
            "leasing",
            "discovering",
            "diffing",
            "fetching",
            "rendering",
            "enriching",
            "normalizing",
            "parsing",
            "graphing",
            "preparing",
            "batching",
            "embedding",
            "vectorizing",
            "upserting",
            "retrieving",
            "synthesizing",
            "evaluating",
            "publishing",
            "cleaning",
            "complete",
            "canceled",
        ],
    ),
    (
        "JobKind",
        &[
            "source",
            "watch",
            "map",
            "extract",
            "research",
            "ask",
            "query",
            "retrieve",
            "memory",
            "graph",
            "prune",
            "provider_probe",
            "reset",
        ],
    ),
    (
        "LifecycleStatus",
        &[
            "queued",
            "pending",
            "running",
            "waiting",
            "blocked",
            "canceling",
            "completed",
            "completed_degraded",
            "failed",
            "canceled",
            "expired",
            "skipped",
        ],
    ),
];

pub fn check_removed_surface_drift(artifacts: &[SchemaArtifact]) -> Result<()> {
    for artifact in artifacts {
        for token in REMOVED_SURFACE_TOKENS {
            if artifact.content.contains(token) {
                bail!(
                    "{} contains removed public surface token {}",
                    artifact.path.display(),
                    token
                );
            }
        }
    }
    Ok(())
}

pub fn check_enum_projection_drift(artifacts: &[SchemaArtifact]) -> Result<()> {
    let Some(api) = artifacts
        .iter()
        .find(|artifact| artifact.path == std::path::Path::new("docs/reference/api/schemas.json"))
    else {
        return Ok(());
    };

    for (name, values) in CANONICAL_ENUMS {
        if !api.content.contains(&format!("\"{name}\"")) {
            bail!("api schema is missing canonical enum {name}");
        }
        for value in *values {
            if !api.content.contains(&format!("\"{value}\"")) {
                bail!("api schema enum {name} is missing value {value}");
            }
        }
    }
    Ok(())
}
