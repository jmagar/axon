use crate::crates::core::config::Config;
use crate::crates::core::logging::log_warn;
use crate::crates::vector::ops::{EmbedDocument, embed_documents_batch};
use std::future::Future;
use std::pin::Pin;

#[derive(Debug, Clone, Copy, Default)]
pub struct EmbedBatchResult {
    pub chunks_embedded: usize,
    pub fallback_failures: usize,
}

pub async fn embed_documents_in_batches<F>(
    cfg: &Config,
    docs: &[EmbedDocument],
    batch_size: usize,
    command: &str,
    mut fallback_embed: F,
    mut on_progress: impl FnMut(usize),
) -> EmbedBatchResult
where
    F: for<'a> FnMut(
        &'a Config,
        &'a EmbedDocument,
    ) -> Pin<Box<dyn Future<Output = Result<usize, String>> + Send + 'a>>,
{
    let mut result = EmbedBatchResult::default();

    for batch in docs.chunks(batch_size.max(1)) {
        let batch_result = embed_documents_batch(cfg, batch).await;
        if let Ok(summary) = batch_result {
            result.chunks_embedded += summary.chunks_embedded;
            on_progress(result.chunks_embedded);
            continue;
        }

        let err_msg = batch_result
            .err()
            .map(|err| err.to_string())
            .unwrap_or_else(|| "unknown error".to_string());
        log_warn(&format!(
            "command={command} embed_batch_failed docs={} err={err_msg}; falling_back_to_per_doc_embedding",
            batch.len(),
        ));

        for doc in batch {
            match fallback_embed(cfg, doc).await {
                Ok(chunks) => {
                    result.chunks_embedded += chunks;
                    on_progress(result.chunks_embedded);
                }
                Err(fallback_err) => {
                    result.fallback_failures += 1;
                    log_warn(&format!(
                        "command={command} embed_fallback_failed url={} err={fallback_err}",
                        doc.url,
                    ));
                }
            }
        }
    }

    result
}
