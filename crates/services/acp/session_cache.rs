//! Global ACP session cache — adapters survive WebSocket disconnects.
//!
//! `SESSION_CACHE` is a process-wide singleton that holds `AcpConnectionHandle`
//! instances keyed by agent key. When a WebSocket disconnects, the adapter stays
//! alive in the cache. On reconnect, the client resumes the same adapter and
//! receives any events buffered during the disconnect.
//!
//! Idle sessions are reaped after `SESSION_TTL` (default 30 minutes).

use std::sync::Arc;
use std::time::{Duration, Instant};

use dashmap::DashMap;
use tokio::sync::Mutex;

use super::PermissionResponderMap;
use super::persistent_conn::AcpConnectionHandle;

/// Default idle TTL before a cached session is evicted.
const SESSION_TTL: Duration = Duration::from_secs(30 * 60);

/// Maximum number of serialized WS JSON messages buffered per session during a
/// client disconnect. Prevents unbounded memory growth from very chatty turns.
const MAX_REPLAY_BUFFER: usize = 4096;

/// Process-wide ACP session cache.
pub static SESSION_CACHE: std::sync::LazyLock<AcpSessionCache> =
    std::sync::LazyLock::new(AcpSessionCache::new);

/// A cached ACP adapter session.
pub struct CachedSession {
    pub handle: Arc<AcpConnectionHandle>,
    pub permission_responders: PermissionResponderMap,
    last_active: Mutex<Instant>,
    /// Serialized WS JSON messages buffered while no client is connected.
    replay_buffer: Mutex<Vec<String>>,
}

impl CachedSession {
    fn new(
        handle: Arc<AcpConnectionHandle>,
        permission_responders: PermissionResponderMap,
    ) -> Self {
        Self {
            handle,
            permission_responders,
            last_active: Mutex::new(Instant::now()),
            replay_buffer: Mutex::new(Vec::new()),
        }
    }

    /// Touch the session to reset its idle TTL.
    pub async fn touch(&self) {
        *self.last_active.lock().await = Instant::now();
    }

    /// Append a serialized WS message to the replay buffer.
    pub async fn buffer_event(&self, json: String) {
        let mut buf = self.replay_buffer.lock().await;
        if buf.len() < MAX_REPLAY_BUFFER {
            buf.push(json);
        }
    }

    /// Drain and return all buffered events for replay to a reconnecting client.
    pub async fn drain_replay_buffer(&self) -> Vec<String> {
        let mut buf = self.replay_buffer.lock().await;
        std::mem::take(&mut *buf)
    }

    async fn is_expired(&self) -> bool {
        let last = *self.last_active.lock().await;
        last.elapsed() > SESSION_TTL
    }
}

/// Global cache of live ACP adapter sessions.
///
/// Keyed by `agent_key` (e.g. `"Claude:mcp=12345"`), same key used by
/// `get_or_create_acp_connection` in `pulse_chat.rs`.
pub struct AcpSessionCache {
    sessions: DashMap<String, Arc<CachedSession>>,
    /// Maps ACP `session_id` → `agent_key` for reconnect lookups.
    session_id_index: DashMap<String, String>,
    reaper_started: std::sync::Once,
}

impl AcpSessionCache {
    fn new() -> Self {
        Self {
            sessions: DashMap::new(),
            session_id_index: DashMap::new(),
            reaper_started: std::sync::Once::new(),
        }
    }

    /// Ensure the background reaper task is running (idempotent).
    pub fn ensure_reaper(&self) {
        self.reaper_started.call_once(|| {
            tokio::spawn(reaper_loop());
        });
    }

    /// Get an existing cached session by agent key.
    pub async fn get(&self, agent_key: &str) -> Option<Arc<CachedSession>> {
        let entry = self.sessions.get(agent_key)?;
        let session = Arc::clone(entry.value());
        session.touch().await;
        Some(session)
    }

    /// Synchronous (non-touching) lookup by agent key.
    ///
    /// Used where we cannot `.await` (e.g. `send_or_buffer` fallback path).
    pub fn get_sync(&self, agent_key: &str) -> Option<Arc<CachedSession>> {
        let entry = self.sessions.get(agent_key)?;
        Some(Arc::clone(entry.value()))
    }

    /// Get a cached session by ACP session_id (for reconnect lookups).
    pub async fn get_by_session_id(&self, session_id: &str) -> Option<Arc<CachedSession>> {
        let agent_key = self.session_id_index.get(session_id)?.value().clone();
        self.get(&agent_key).await
    }

    /// Get a cached session by ACP session_id synchronously (for permission routing).
    pub fn get_by_session_id_sync(&self, session_id: &str) -> Option<Arc<CachedSession>> {
        let agent_key = self.session_id_index.get(session_id)?.value().clone();
        self.sessions.get(&agent_key).map(|e| Arc::clone(e.value()))
    }

    /// Insert or replace a cached session.
    pub fn insert(
        &self,
        agent_key: String,
        handle: Arc<AcpConnectionHandle>,
        permission_responders: PermissionResponderMap,
    ) -> Arc<CachedSession> {
        let session = Arc::new(CachedSession::new(handle, permission_responders));
        self.sessions.insert(agent_key, Arc::clone(&session));
        self.ensure_reaper();
        session
    }

    /// Register a mapping from ACP session_id to agent_key.
    ///
    /// Called after the first turn establishes a session so that reconnecting
    /// clients can look up the adapter by the session_id they remember.
    pub fn register_session_id(&self, session_id: String, agent_key: String) {
        self.session_id_index.insert(session_id, agent_key);
    }

    /// Remove a session by agent key (e.g. on agent change).
    pub fn remove(&self, agent_key: &str) {
        if let Some((_, _session)) = self.sessions.remove(agent_key) {
            // Clean up session_id_index entries pointing to this agent_key.
            self.session_id_index.retain(|_, v| v.as_str() != agent_key);
        }
    }

    /// Evict expired sessions.
    async fn reap_expired(&self) {
        let mut to_remove = Vec::new();
        for entry in self.sessions.iter() {
            if entry.value().is_expired().await {
                to_remove.push(entry.key().clone());
            }
        }
        for key in &to_remove {
            log::info!("[acp_cache] evicting expired session: {key}");
            self.remove(key);
        }
    }

    /// Returns an iterator over all cached sessions.
    pub fn sessions_iter(&self) -> dashmap::iter::Iter<'_, String, Arc<CachedSession>> {
        self.sessions.iter()
    }

    /// Returns a list of all active agent keys in the cache.
    pub fn agent_keys(&self) -> Vec<String> {
        self.sessions.iter().map(|e| e.key().clone()).collect()
    }

    /// Number of cached sessions (for diagnostics).
    pub fn len(&self) -> usize {
        self.sessions.len()
    }

    /// Whether the cache is empty.
    pub fn is_empty(&self) -> bool {
        self.sessions.is_empty()
    }
}

/// Background task that periodically reaps expired sessions.
async fn reaper_loop() {
    let mut interval = tokio::time::interval(Duration::from_secs(60));
    loop {
        interval.tick().await;
        SESSION_CACHE.reap_expired().await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_starts_empty() {
        let cache = AcpSessionCache::new();
        assert!(cache.is_empty());
        assert_eq!(cache.len(), 0);
    }
}
