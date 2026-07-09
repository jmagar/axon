//! `memory import`/`memory export` — bulk record transfer.
//!
//! Bypasses the flat [`MemoryRequest`]/[`dispatch`] shape (unlike every other
//! subaction in `super`): import carries a `records` bundle and export returns
//! one, neither of which fit the single-memory request/response shape the rest
//! of the `memory` surface uses. Transport-neutral entry points consumed
//! directly by REST `POST /v1/memories/import` / `POST /v1/memories/export`
//! and the MCP `memory` `import`/`export` subactions.

use super::*;
use axon_api::source::{
    MemoryExportRequest, MemoryExportResult, MemoryImportMode, MemoryImportRequest,
    MemoryImportResult,
};

/// Bulk-import memory records (or preview a dry-run plan).
pub async fn import(ctx: &ServiceContext, req: MemoryImportRequest) -> Result<MemoryImportResult> {
    let store = memory_store(ctx).await?;
    store.import(req).await.map_err(store_err)
}

/// Export memory records matching a scope.
pub async fn export(ctx: &ServiceContext, req: MemoryExportRequest) -> Result<MemoryExportResult> {
    let store = memory_store(ctx).await?;
    store.export(req).await.map_err(store_err)
}

/// Build a [`MemoryImportRequest`] from the flat CLI/MCP [`MemoryRequest`]
/// shape (`dispatch`'s `MemorySubaction::Import` arm).
pub(crate) fn import_request_from_flat(req: MemoryRequest) -> Result<MemoryImportRequest> {
    let records = req
        .records
        .filter(|records| !records.is_empty())
        .context("import requires records (at least 1)")?;
    Ok(MemoryImportRequest {
        records,
        mode: req.import_mode.unwrap_or(MemoryImportMode::Merge),
        dry_run: req.dry_run.unwrap_or(false),
    })
}

/// Build a [`MemoryExportRequest`] from the flat CLI/MCP [`MemoryRequest`]
/// shape (`dispatch`'s `MemorySubaction::Export` arm).
pub(crate) fn export_request_from_flat(req: MemoryRequest) -> MemoryExportRequest {
    MemoryExportRequest {
        scope: req.export_scope,
        include_archived: req.include_archived.unwrap_or(false),
    }
}
