use async_trait::async_trait;
use axon_api::source::*;
use std::sync::{Arc, Mutex};

use crate::scope_satisfies;
#[cfg(test)]
use crate::{AXON_FULL_ACCESS_SCOPE, AXON_READ_SCOPE};

pub type Result<T> = std::result::Result<T, ApiError>;

#[async_trait]
pub trait SecurityPolicy: Send + Sync {
    async fn authorize_source(&self, request: SecurityPolicyRequest) -> Result<SecurityDecision>;
    async fn capabilities(&self) -> Result<ProviderCapability>;
}

#[async_trait]
pub trait CredentialProvider: Send + Sync {
    async fn resolve(&self, request: CredentialRequest) -> Result<CredentialMaterial>;
    async fn capabilities(&self) -> Result<ProviderCapability>;
}

#[derive(Debug, Clone)]
pub struct ScopeSecurityPolicy {
    required_scope: String,
}

impl ScopeSecurityPolicy {
    pub fn new(required_scope: impl Into<String>) -> Self {
        Self {
            required_scope: required_scope.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct FakeCredentialProvider {
    health: HealthStatus,
    mode: FakeCredentialMode,
    calls: Arc<Mutex<Vec<&'static str>>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FakeCredentialMode {
    Success,
    Timeout,
    RateLimited,
    Fatal,
}

impl FakeCredentialProvider {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_health(mut self, health: HealthStatus) -> Self {
        self.health = health;
        self
    }

    pub fn with_mode(mut self, mode: FakeCredentialMode) -> Self {
        self.mode = mode;
        self
    }

    pub async fn calls(&self) -> Vec<&'static str> {
        self.calls
            .lock()
            .expect("credential fake call log mutex poisoned")
            .clone()
    }

    fn record(&self, call: &'static str) {
        self.calls
            .lock()
            .expect("credential fake call log mutex poisoned")
            .push(call);
    }

    fn mode_error(&self) -> Option<ApiError> {
        let (code, message) = match self.mode {
            FakeCredentialMode::Success => return None,
            FakeCredentialMode::Timeout => ("provider.timeout", "credential provider timed out"),
            FakeCredentialMode::RateLimited => {
                ("provider.rate_limited", "credential provider rate limited")
            }
            FakeCredentialMode::Fatal => ("provider.fatal", "credential provider failed fatally"),
        };
        let mut error = ApiError::new(code, axon_error::ErrorStage::Authorizing, message)
            .with_provider_id("fake-credential-provider");
        if self.mode == FakeCredentialMode::Fatal {
            error.retryable = false;
        }
        Some(error)
    }

    fn capability_health(&self) -> HealthStatus {
        match self.mode {
            FakeCredentialMode::Success => self.health,
            FakeCredentialMode::Timeout => HealthStatus::Degraded,
            FakeCredentialMode::RateLimited => HealthStatus::Cooling,
            FakeCredentialMode::Fatal => HealthStatus::Unavailable,
        }
    }

    fn capability_cooldown(&self) -> Option<Timestamp> {
        (self.mode == FakeCredentialMode::RateLimited)
            .then(|| Timestamp("2026-07-01T00:00:30Z".to_string()))
    }
}

impl Default for FakeCredentialProvider {
    fn default() -> Self {
        Self {
            health: HealthStatus::Healthy,
            mode: FakeCredentialMode::Success,
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

#[async_trait]
impl CredentialProvider for FakeCredentialProvider {
    async fn resolve(&self, request: CredentialRequest) -> Result<CredentialMaterial> {
        self.record("credential.resolve");
        if let Some(err) = self.mode_error() {
            return Err(err);
        }
        Ok(CredentialMaterial {
            secret_ref: request.secret_ref,
            credential_kind: request.credential_kind,
            redacted_value: "redacted".to_string(),
            expires_at: None,
            metadata: request.metadata,
        })
    }

    async fn capabilities(&self) -> Result<ProviderCapability> {
        Ok(provider_capability(
            ProviderKind::Credential,
            "fake-credential-provider",
            "fake",
            vec!["resolve".to_string()],
            true,
            self.capability_health(),
            self.capability_cooldown(),
            self.mode_error(),
        ))
    }
}

#[async_trait]
impl SecurityPolicy for ScopeSecurityPolicy {
    async fn authorize_source(&self, request: SecurityPolicyRequest) -> Result<SecurityDecision> {
        let allowed = scope_satisfies(&request.caller.scopes, &self.required_scope);
        Ok(SecurityDecision {
            allowed,
            scope: self.required_scope.clone(),
            reason: if allowed {
                "authorized.scope_satisfied".to_string()
            } else {
                "denied.scope_missing".to_string()
            },
            redactions: Vec::new(),
            warnings: Vec::new(),
        })
    }

    async fn capabilities(&self) -> Result<ProviderCapability> {
        Ok(provider_capability(
            ProviderKind::Security,
            "scope-security-policy",
            "scope",
            vec!["source_authorization".to_string()],
            false,
            HealthStatus::Healthy,
            None,
            None,
        ))
    }
}

fn provider_capability(
    provider_kind: ProviderKind,
    provider_id: &str,
    implementation: &str,
    features: Vec<String>,
    fake_overrides_supported: bool,
    health: HealthStatus,
    cooldown_until: Option<Timestamp>,
    last_error: Option<ApiError>,
) -> ProviderCapability {
    ProviderCapability {
        provider_id: ProviderId::new(provider_id),
        provider_kind,
        implementation: implementation.to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        health,
        limits: ProviderLimits::default(),
        features,
        cooldown_until,
        last_error,
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
        fake_overrides_supported,
        embedding: None,
        llm: None,
        vector_store: None,
        fetch: None,
        render: None,
        credential: if provider_kind == ProviderKind::Credential {
            Some(CredentialProviderCapability {
                auth_schemes: vec!["api_key".to_string(), "bearer".to_string()],
                redaction_policy: RedactionPolicy::Strict,
            })
        } else {
            None
        },
    }
}

#[cfg(test)]
#[path = "policy_tests.rs"]
mod tests;
