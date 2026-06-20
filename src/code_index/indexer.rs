use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::code_index::config::{
    CodeIndexIdentity, DEFAULT_CHANGED_FILE_BATCH_SIZE, MAX_INDEXED_FILE_BYTES,
};
use crate::code_index::manifest::{FileDiff, FileManifestEntry, ManifestSnapshot};
use crate::code_index::store::CodeIndexStore;
use crate::core::config::Config;
use crate::vector::ops::{
    SourceDocument, SourceOrigin, embed_prepared_docs, prepare_source_document,
};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct ReindexSummary {
    pub indexed_files: usize,
    pub removed_files: usize,
}

pub(crate) async fn reindex_changed_files(
    cfg: &Config,
    store: &CodeIndexStore,
    identity: &CodeIndexIdentity,
    manifest: &ManifestSnapshot,
    diff: &FileDiff,
) -> anyhow::Result<ReindexSummary> {
    let generation = store.next_generation(identity).await?;
    reindex_changed_files_inner(Some(cfg), store, identity, manifest, diff, generation, None).await
}

async fn reindex_changed_files_inner(
    cfg: Option<&Config>,
    store: &CodeIndexStore,
    identity: &CodeIndexIdentity,
    manifest: &ManifestSnapshot,
    diff: &FileDiff,
    generation: i64,
    test_deletes: Option<Arc<Mutex<Vec<String>>>>,
) -> anyhow::Result<ReindexSummary> {
    let mut summary = ReindexSummary::default();
    let previous_generation = generation.saturating_sub(1);

    for removed in &diff.removed {
        delete_previous_generation(cfg, identity, previous_generation, removed, &test_deletes)
            .await?;
        store.remove_file(identity, removed).await?;
        summary.removed_files += 1;
    }

    let changed_entries = diff.changed_entries().cloned().collect::<Vec<_>>();
    for batch in changed_entries.chunks(changed_file_batch_size()) {
        let mut prepared = Vec::new();
        let mut indexed_without_embed = Vec::new();

        for entry in batch {
            store
                .mark_file_pending(identity, &entry.relative_path)
                .await?;
            if entry.size_bytes == 0 {
                delete_previous_generation(
                    cfg,
                    identity,
                    previous_generation,
                    &entry.relative_path,
                    &test_deletes,
                )
                .await?;
                indexed_without_embed.push(entry.clone());
                continue;
            }

            let Some(doc) = prepare_local_code_doc(identity, entry, generation).await? else {
                delete_previous_generation(
                    cfg,
                    identity,
                    previous_generation,
                    &entry.relative_path,
                    &test_deletes,
                )
                .await?;
                indexed_without_embed.push(entry.clone());
                continue;
            };
            prepared.push(doc);
        }

        if let Some(cfg) = cfg
            && !prepared.is_empty()
        {
            embed_prepared_docs(cfg, prepared, None)
                .await
                .map_err(|err| anyhow::anyhow!("code search embed failed: {err}"))?
                .require_success("code search embed")
                .map_err(|err| anyhow::anyhow!(err))?;
        }

        for entry in batch {
            store.mark_file_indexed(identity, entry, generation).await?;
            summary.indexed_files += 1;
        }
        for entry in indexed_without_embed {
            if !manifest
                .files
                .iter()
                .any(|candidate| candidate.relative_path == entry.relative_path)
            {
                continue;
            }
        }
    }

    store.commit_generation(identity, generation).await?;
    Ok(summary)
}

async fn prepare_local_code_doc(
    identity: &CodeIndexIdentity,
    entry: &FileManifestEntry,
    generation: i64,
) -> anyhow::Result<Option<crate::vector::ops::PreparedDoc>> {
    let path = identity.project_root.join(&entry.relative_path);
    let metadata = tokio::fs::metadata(&path).await?;
    if metadata.len() > MAX_INDEXED_FILE_BYTES {
        return Ok(None);
    }
    let bytes = tokio::fs::read(&path).await?;
    let content = match String::from_utf8(bytes) {
        Ok(content) if !content.trim().is_empty() => content,
        _ => return Ok(None),
    };
    let ext = Path::new(&entry.relative_path)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let extra = serde_json::json!({
        "source_type": "local_code",
        "local_project_key": identity.project_key,
        "local_project_display": identity.project_display,
        "local_file_hash": entry.hash.as_deref().unwrap_or_default(),
        "local_index_version": identity.index_version,
        "local_generation": generation,
        "code_file_path": entry.relative_path,
        "code_path_prefixes": code_path_prefixes(&entry.relative_path),
    });
    let url = format!(
        "local-code://{}/{}",
        identity.project_key,
        percent_encoding::utf8_percent_encode(
            &entry.relative_path,
            percent_encoding::NON_ALPHANUMERIC
        )
    );
    let source = SourceDocument::try_new_file(
        SourceOrigin::LocalFile,
        url,
        entry.relative_path.clone(),
        ext,
        content,
        "local_code",
        Some(entry.relative_path.clone()),
        Some(extra),
    )
    .map_err(|err| anyhow::anyhow!("invalid local code source document: {err}"))?;
    prepare_source_document(source)
        .await
        .map(Some)
        .map_err(|err| anyhow::anyhow!("prepare local code source document failed: {err}"))
}

pub(crate) fn code_path_prefixes(relative_path: &str) -> Vec<String> {
    let mut prefixes = Vec::new();
    let mut current = String::new();
    let parts = relative_path.split('/').collect::<Vec<_>>();
    for part in parts.iter().take(parts.len().saturating_sub(1)) {
        if part.is_empty() {
            continue;
        }
        current.push_str(part);
        current.push('/');
        prefixes.push(current.clone());
    }
    prefixes
}

async fn delete_previous_generation(
    cfg: Option<&Config>,
    identity: &CodeIndexIdentity,
    previous_generation: i64,
    path: &str,
    test_deletes: &Option<Arc<Mutex<Vec<String>>>>,
) -> anyhow::Result<()> {
    if previous_generation <= 0 {
        if let Some(deletes) = test_deletes {
            deletes.lock().unwrap().push(path.to_string());
        }
        return Ok(());
    }
    if let Some(cfg) = cfg {
        crate::vector::ops::qdrant::qdrant_delete_local_code_files_for_generation(
            cfg,
            &identity.project_key,
            previous_generation,
            &[path.to_string()],
        )
        .await?;
    }
    if let Some(deletes) = test_deletes {
        deletes.lock().unwrap().push(path.to_string());
    }
    Ok(())
}

fn changed_file_batch_size() -> usize {
    std::env::var("AXON_CODE_SEARCH_CHANGED_FILE_BATCH_SIZE")
        .ok()
        .and_then(|value| value.parse::<usize>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_CHANGED_FILE_BATCH_SIZE)
}

#[cfg(test)]
pub(crate) async fn reindex_changed_files_for_test(
    store: &CodeIndexStore,
    identity: &CodeIndexIdentity,
    manifest: &ManifestSnapshot,
    diff: &FileDiff,
    generation: i64,
    deletes: Arc<Mutex<Vec<String>>>,
) -> anyhow::Result<ReindexSummary> {
    reindex_changed_files_inner(
        None,
        store,
        identity,
        manifest,
        diff,
        generation,
        Some(deletes),
    )
    .await
}
