//! Adapter-owned provider boundaries and fakes.

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use axon_api::source::*;

pub type Result<T> = std::result::Result<T, ApiError>;

#[async_trait]
pub trait SearchProvider: Send + Sync {
    async fn search(&self, request: SearchRequest) -> Result<SearchResult>;
    async fn capabilities(&self) -> Result<ProviderCapability>;
}

#[async_trait]
pub trait FetchProvider: Send + Sync {
    async fn fetch(&self, request: FetchRequest) -> Result<FetchedResource>;
    async fn capabilities(&self) -> Result<ProviderCapability>;
}

#[async_trait]
pub trait RenderProvider: Send + Sync {
    async fn render(&self, request: RenderRequest) -> Result<RenderedResource>;
    async fn capabilities(&self) -> Result<ProviderCapability>;
}

#[async_trait]
pub trait NetworkCaptureProvider: Send + Sync {
    async fn capture(&self, request: NetworkCaptureRequest) -> Result<NetworkCaptureResult>;
    async fn capabilities(&self) -> Result<ProviderCapability>;
}

#[derive(Debug, Clone)]
pub struct FakeAdapterProviders {
    health: HealthStatus,
    mode: FakeAdapterMode,
    calls: Arc<Mutex<Vec<&'static str>>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FakeAdapterMode {
    Success,
    Timeout,
    RateLimited,
    Fatal,
}

impl FakeAdapterProviders {
    pub fn new() -> Self {
        Self {
            health: HealthStatus::Healthy,
            mode: FakeAdapterMode::Success,
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn with_health(mut self, health: HealthStatus) -> Self {
        self.health = health;
        self
    }

    pub fn with_mode(mut self, mode: FakeAdapterMode) -> Self {
        self.mode = mode;
        self
    }

    pub async fn calls(&self) -> Vec<&'static str> {
        self.calls
            .lock()
            .expect("adapter fake call log mutex poisoned")
            .clone()
    }

    fn record(&self, call: &'static str) {
        self.calls
            .lock()
            .expect("adapter fake call log mutex poisoned")
            .push(call);
    }

    fn mode_error(&self, stage: axon_error::ErrorStage) -> Option<ApiError> {
        let (code, message) = match self.mode {
            FakeAdapterMode::Success => return None,
            FakeAdapterMode::Timeout => ("provider.timeout", "adapter provider timed out"),
            FakeAdapterMode::RateLimited => {
                ("provider.rate_limited", "adapter provider rate limited")
            }
            FakeAdapterMode::Fatal => ("provider.fatal", "adapter provider failed fatally"),
        };
        let mut error = ApiError::new(code, stage, message);
        if self.mode == FakeAdapterMode::Fatal {
            error.retryable = false;
        }
        Some(error)
    }
}

impl Default for FakeAdapterProviders {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl SearchProvider for FakeAdapterProviders {
    async fn search(&self, request: SearchRequest) -> Result<SearchResult> {
        self.record("search");
        if let Some(err) = self.mode_error(axon_error::ErrorStage::Discovering) {
            return Err(err);
        }
        Ok(SearchResult {
            query: request.query.clone(),
            results: vec![SearchResultItem {
                title: request.query,
                url: "https://example.test/".to_string(),
                snippet: "fake search result".to_string(),
            }],
        })
    }

    async fn capabilities(&self) -> Result<ProviderCapability> {
        Ok(provider_capability(ProviderKind::Search, self.health))
    }
}

#[async_trait]
impl FetchProvider for FakeAdapterProviders {
    async fn fetch(&self, request: FetchRequest) -> Result<FetchedResource> {
        self.record("fetch");
        if let Some(err) = self.mode_error(axon_error::ErrorStage::Fetching) {
            return Err(err);
        }
        Ok(FetchedResource {
            uri: request.uri.clone(),
            final_uri: request.uri,
            status: 200,
            content: ContentRef::InlineText {
                text: "fake fetch".to_string(),
            },
            headers: RedactedHeaders {
                headers: Vec::new(),
            },
            fetched_at: timestamp(),
            etag: Some("fake-etag".to_string()),
            redirect_chain: Vec::new(),
            bytes: Some(10),
            metadata: request.metadata,
        })
    }

    async fn capabilities(&self) -> Result<ProviderCapability> {
        Ok(provider_capability(ProviderKind::Fetch, self.health))
    }
}

#[async_trait]
impl RenderProvider for FakeAdapterProviders {
    async fn render(&self, request: RenderRequest) -> Result<RenderedResource> {
        self.record("render");
        if let Some(err) = self.mode_error(axon_error::ErrorStage::Rendering) {
            return Err(err);
        }
        Ok(RenderedResource {
            uri: request.uri.clone(),
            final_uri: request.uri,
            markdown: "fake render".to_string(),
            html: Some("<p>fake render</p>".to_string()),
            text: Some("fake render".to_string()),
            render_mode: request.mode,
            captured_at: timestamp(),
            artifacts: Vec::new(),
            console: Vec::new(),
            network: Vec::new(),
            metadata: request.metadata,
        })
    }

    async fn capabilities(&self) -> Result<ProviderCapability> {
        Ok(provider_capability(ProviderKind::Render, self.health))
    }
}

#[async_trait]
impl NetworkCaptureProvider for FakeAdapterProviders {
    async fn capture(&self, request: NetworkCaptureRequest) -> Result<NetworkCaptureResult> {
        self.record("capture");
        if let Some(err) = self.mode_error(axon_error::ErrorStage::Discovering) {
            return Err(err);
        }
        Ok(NetworkCaptureResult {
            uri: request.uri,
            captured_at: timestamp(),
            entries: Vec::new(),
            artifacts: Vec::new(),
            metadata: request.metadata,
        })
    }

    async fn capabilities(&self) -> Result<ProviderCapability> {
        Ok(provider_capability(
            ProviderKind::NetworkCapture,
            self.health,
        ))
    }
}

fn provider_capability(provider_kind: ProviderKind, health: HealthStatus) -> ProviderCapability {
    ProviderCapability {
        provider_id: ProviderId::new(format!("fake_{provider_kind:?}").to_lowercase()),
        provider_kind,
        implementation: "fake".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        health,
        limits: ProviderLimits::default(),
        features: vec!["fake".to_string()],
        cooldown_until: None,
        last_error: None,
        reservation_policy: ReservationPolicy {
            supports_reservations: false,
            queue_policy: QueuePolicy::Fifo,
            interactive_reserve: 0,
            cooldown_after_failures: 0,
            cooldown_secs: 0,
            retry_backoff_ms: None,
        },
        reservation_state: ReservationStateSnapshot {
            queued: 0,
            active: 0,
            available_units: 1,
            oldest_queued_ms: None,
            priority_breakdown: Default::default(),
            states: Vec::new(),
        },
        cost_class: ProviderCostClass::Internal,
        degraded_modes: Vec::new(),
        fake_overrides_supported: true,
        embedding: None,
        llm: None,
        vector_store: None,
        fetch: None,
        render: None,
        credential: None,
    }
}

fn timestamp() -> Timestamp {
    Timestamp("2026-07-01T00:00:00Z".to_string())
}

#[cfg(test)]
#[path = "boundary_tests.rs"]
mod tests;
