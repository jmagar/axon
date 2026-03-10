use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use tokio::sync::mpsc;

use crate::crates::core::config::Config;
use crate::crates::services::map as map_svc;
use crate::crates::services::query as query_svc;
use crate::crates::services::scrape as scrape_svc;
use crate::crates::services::screenshot as screenshot_svc;
use crate::crates::services::search as search_svc;
use crate::crates::services::system as system_svc;
use crate::crates::services::types::{
    AskResult, DedupeResult, DoctorResult, DomainsResult, EvaluateResult, MapOptions, MapResult,
    Pagination, QueryResult, ResearchResult, RetrieveOptions, RetrieveResult, ScrapeResult,
    ScreenshotResult, SearchOptions, SearchResult, SourcesResult, StatsResult, StatusResult,
    SuggestResult,
};

use super::super::events::{
    CommandContext, CommandDonePayload, CommandErrorPayload, WsEventV2, serialize_v2_event,
};
use super::types::SvcError;

// ── Owned WS event senders ─────────────────────────────────────────────────────

/// Send a JSON output event, taking all parameters by owned value to avoid
/// holding borrows across `.await` points in the async state machine.
pub(super) async fn send_json_owned(
    tx: mpsc::Sender<String>,
    ctx: CommandContext,
    data: serde_json::Value,
) {
    use super::super::events::WsEventV2;
    if let Some(v2) = serialize_v2_event(WsEventV2::CommandOutputJson { ctx, data }) {
        let _ = tx.send(v2).await;
    }
}

/// Send a `command.done` event, taking all parameters by owned value.
pub(super) async fn send_done_owned(
    tx: mpsc::Sender<String>,
    ctx: CommandContext,
    exit_code: i32,
    elapsed_ms: Option<u64>,
) {
    if let Some(v2) = serialize_v2_event(WsEventV2::CommandDone {
        ctx,
        payload: CommandDonePayload {
            exit_code,
            elapsed_ms,
        },
    }) {
        let _ = tx.send(v2).await;
    }
}

/// Send a `command.error` event, taking all parameters by owned value.
pub(super) async fn send_error_owned(
    tx: mpsc::Sender<String>,
    ctx: CommandContext,
    message: String,
    elapsed_ms: Option<u64>,
) {
    if let Some(v2) = serialize_v2_event(WsEventV2::CommandError {
        ctx,
        payload: CommandErrorPayload {
            message,
            elapsed_ms,
        },
    }) {
        let _ = tx.send(v2).await;
    }
}

// ── Service call wrappers ─────────────────────────────────────────────────────
//
// Each wrapper returns `Pin<Box<dyn Future<Output=…> + Send + 'static>>`.
//
// Why boxing is required
// ──────────────────────
// Service functions take `&Config` and `&str` parameters.  When an `async fn`
// with such parameters is awaited inside a future submitted to
// `tokio::task::spawn`, rustc generates Higher-Ranked Trait Bound (HRTB)
// constraints of the form `for<'a> &'a Config: Send` and `for<'a> &'a str: Send`.
// These constraints are always true at runtime (`Config: Sync`, `str: Sync`),
// but rustc's current HRTB solver cannot prove them in this context
// (rust-lang/rust#96865) and emits "implementation of `Send` is not general
// enough".
//
// The fix: wrap each service call in `Box::pin(async move { … })`.
// • The `async move` block captures `cfg: Arc<Config>` and `input: String`
//   by value.  Both types are `'static`.
// • Inside the block, `&*cfg` and `input.as_str()` borrow data owned by the
//   closure itself — the lifetimes are fully determined and `'static`-adjacent.
// • `Box::pin` erases the concrete future type into `Pin<Box<dyn Future + Send
//   + 'static>>`.  Type erasure eliminates the lifetime parameters that trigger
//   the HRTB check.
// • The returned boxed future is `Send + 'static` by construction, satisfying
//   `tokio::task::spawn`.
//
// `Arc<Config>` (not `Config`) is used so `.clone()` inside each wrapper is a
// cheap reference-count bump, not a full struct copy.

pub(super) fn call_scrape(
    cfg: Arc<Config>,
    url: String,
) -> Pin<Box<dyn Future<Output = Result<ScrapeResult, SvcError>> + Send + 'static>> {
    Box::pin(async move {
        scrape_svc::scrape(&cfg, &url)
            .await
            .map_err(|e| -> SvcError { format!("{e}").into() })
    })
}

pub(super) fn call_map(
    cfg: Arc<Config>,
    url: String,
    opts: MapOptions,
) -> Pin<Box<dyn Future<Output = Result<MapResult, SvcError>> + Send + 'static>> {
    Box::pin(async move {
        map_svc::discover(&cfg, &url, opts, None)
            .await
            .map_err(|e| -> SvcError { format!("{e}").into() })
    })
}

pub(super) fn call_query(
    cfg: Arc<Config>,
    text: String,
    pagination: Pagination,
) -> Pin<Box<dyn Future<Output = Result<QueryResult, SvcError>> + Send + 'static>> {
    Box::pin(async move {
        query_svc::query(&cfg, &text, pagination)
            .await
            .map_err(|e| -> SvcError { format!("{e}").into() })
    })
}

pub(super) fn call_retrieve(
    cfg: Arc<Config>,
    url: String,
    opts: RetrieveOptions,
) -> Pin<Box<dyn Future<Output = Result<RetrieveResult, SvcError>> + Send + 'static>> {
    Box::pin(async move {
        query_svc::retrieve(&cfg, &url, opts)
            .await
            .map_err(|e| -> SvcError { format!("{e}").into() })
    })
}

pub(super) fn call_ask(
    cfg: Arc<Config>,
    question: String,
) -> Pin<Box<dyn Future<Output = Result<AskResult, SvcError>> + Send + 'static>> {
    Box::pin(async move {
        query_svc::ask(&cfg, &question, None)
            .await
            .map_err(|e| -> SvcError { format!("{e}").into() })
    })
}

pub(super) fn call_search(
    cfg: Arc<Config>,
    query: String,
    opts: SearchOptions,
) -> Pin<Box<dyn Future<Output = Result<SearchResult, SvcError>> + Send + 'static>> {
    Box::pin(async move {
        search_svc::search(&cfg, &query, opts, None)
            .await
            .map_err(|e| -> SvcError { format!("{e}").into() })
    })
}

pub(super) fn call_research(
    cfg: Arc<Config>,
    query: String,
    opts: SearchOptions,
) -> Pin<Box<dyn Future<Output = Result<ResearchResult, SvcError>> + Send + 'static>> {
    Box::pin(async move {
        search_svc::research(&cfg, &query, opts, None)
            .await
            .map_err(|e| -> SvcError { format!("{e}").into() })
    })
}

pub(super) fn call_stats(
    cfg: Arc<Config>,
) -> Pin<Box<dyn Future<Output = Result<StatsResult, SvcError>> + Send + 'static>> {
    Box::pin(async move {
        system_svc::stats(&cfg)
            .await
            .map_err(|e| -> SvcError { format!("{e}").into() })
    })
}

pub(super) fn call_sources(
    cfg: Arc<Config>,
    pagination: Pagination,
) -> Pin<Box<dyn Future<Output = Result<SourcesResult, SvcError>> + Send + 'static>> {
    Box::pin(async move {
        system_svc::sources(&cfg, pagination)
            .await
            .map_err(|e| -> SvcError { format!("{e}").into() })
    })
}

pub(super) fn call_domains(
    cfg: Arc<Config>,
    pagination: Pagination,
) -> Pin<Box<dyn Future<Output = Result<DomainsResult, SvcError>> + Send + 'static>> {
    Box::pin(async move {
        system_svc::domains(&cfg, pagination)
            .await
            .map_err(|e| -> SvcError { format!("{e}").into() })
    })
}

pub(super) fn call_doctor(
    cfg: Arc<Config>,
) -> Pin<Box<dyn Future<Output = Result<DoctorResult, SvcError>> + Send + 'static>> {
    Box::pin(async move {
        system_svc::doctor(&cfg)
            .await
            .map_err(|e| -> SvcError { format!("{e}").into() })
    })
}

pub(super) fn call_status(
    cfg: Arc<Config>,
) -> Pin<Box<dyn Future<Output = Result<StatusResult, SvcError>> + Send + 'static>> {
    Box::pin(async move {
        system_svc::full_status(&cfg)
            .await
            .map_err(|e| -> SvcError { format!("{e}").into() })
    })
}

pub(super) fn call_suggest(
    cfg: Arc<Config>,
    focus: Option<String>,
) -> Pin<Box<dyn Future<Output = Result<SuggestResult, SvcError>> + Send + 'static>> {
    Box::pin(async move {
        query_svc::suggest(&cfg, focus.as_deref())
            .await
            .map_err(|e| -> SvcError { format!("{e}").into() })
    })
}

/// Evaluate requires special handling: the internal streaming code holds
/// `Box<dyn Error>` (not `Send`) across `.await` points, making the future
/// non-`Send`.  We work around this by spawning on a `LocalSet` inside a
/// dedicated OS thread, then awaiting the result via a oneshot channel.
pub(super) fn call_evaluate(
    cfg: Arc<Config>,
    question: String,
) -> Pin<Box<dyn Future<Output = Result<EvaluateResult, SvcError>> + Send + 'static>> {
    Box::pin(async move {
        let (tx, rx) = tokio::sync::oneshot::channel();
        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .expect("evaluate runtime");
            let local = tokio::task::LocalSet::new();
            local.block_on(&rt, async move {
                let result = query_svc::evaluate(&cfg, &question)
                    .await
                    .map_err(|e| -> SvcError { format!("{e}").into() });
                let _ = tx.send(result);
            });
        });
        rx.await
            .map_err(|_| -> SvcError { "evaluate task panicked".into() })?
    })
}

pub(super) fn call_dedupe(
    cfg: Arc<Config>,
) -> Pin<Box<dyn Future<Output = Result<DedupeResult, SvcError>> + Send + 'static>> {
    Box::pin(async move {
        system_svc::dedupe(&cfg, None)
            .await
            .map_err(|e| -> SvcError { format!("{e}").into() })
    })
}

pub(super) fn call_screenshot(
    cfg: Arc<Config>,
    url: String,
) -> Pin<Box<dyn Future<Output = Result<ScreenshotResult, SvcError>> + Send + 'static>> {
    Box::pin(async move {
        screenshot_svc::screenshot_capture(&cfg, &url)
            .await
            .map_err(|e| -> SvcError { format!("{e}").into() })
    })
}
