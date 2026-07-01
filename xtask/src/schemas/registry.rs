use anyhow::{Result, bail};

use super::artifact::SchemaArtifact;

pub const REMOVED_SURFACE_TOKENS: &[&str] = &[
    "\"EmbedRequest\"",
    "\"IngestRequest\"",
    "\"CrawlRequest\"",
    "\"ScrapeRequest\"",
    "\"code-search-watch\"",
    "\"/v1/embed\"",
    "\"/v1/ingest\"",
    "\"/v1/crawl\"",
    "\"action=embed\"",
    "\"action=ingest\"",
    "\"action=crawl\"",
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
