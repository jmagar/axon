//! Compatibility exports for shared provider reservations.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use axon_api::source::{JobPriority, ProviderId, ProviderKind, ReservationStateSnapshot};

pub use axon_observe::reservation::{
    ProviderReservation, ProviderReservationConfig, ProviderReservationManager,
    ProviderReservationOutcome,
};

pub type Result<T> = axon_observe::reservation::Result<T>;

#[derive(Debug, Clone)]
pub struct ProviderReservations {
    capacity: u32,
    interactive_reserve: u32,
    managers: Arc<Mutex<BTreeMap<String, ProviderReservationManager>>>,
}

impl ProviderReservations {
    pub fn new(capacity: u32, interactive_reserve: u32) -> Self {
        Self {
            capacity,
            interactive_reserve,
            managers: Arc::new(Mutex::new(BTreeMap::new())),
        }
    }

    pub async fn reserve(
        &self,
        provider_id: ProviderId,
        priority: JobPriority,
        units: u32,
    ) -> Result<ProviderReservation> {
        self.manager_for(provider_id).reserve(priority, units).await
    }

    pub async fn snapshot(&self) -> ReservationStateSnapshot {
        let managers = self
            .managers
            .lock()
            .expect("provider reservations mutex poisoned")
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut snapshot = ReservationStateSnapshot {
            queued: 0,
            active: 0,
            available_units: 0,
            oldest_queued_ms: None,
            priority_breakdown: Default::default(),
            states: Vec::new(),
        };
        for manager in managers {
            let provider = manager.snapshot().await;
            snapshot.queued += provider.queued;
            snapshot.active += provider.active;
            snapshot.available_units += provider.available_units;
            snapshot.states.extend(provider.states);
            for (priority, count) in provider.priority_breakdown {
                *snapshot.priority_breakdown.entry(priority).or_default() += count;
            }
            snapshot.oldest_queued_ms = match (snapshot.oldest_queued_ms, provider.oldest_queued_ms)
            {
                (Some(left), Some(right)) => Some(left.min(right)),
                (None, Some(right)) => Some(right),
                (left, None) => left,
            };
        }
        snapshot
    }

    fn manager_for(&self, provider_id: ProviderId) -> ProviderReservationManager {
        let mut managers = self
            .managers
            .lock()
            .expect("provider reservations mutex poisoned");
        managers
            .entry(provider_id.0.clone())
            .or_insert_with(|| {
                ProviderReservationManager::new(ProviderReservationConfig {
                    provider_id,
                    provider_kind: ProviderKind::Embedding,
                    capacity: self.capacity,
                    interactive_reserve: self.interactive_reserve,
                    cooldown_after_failures: 1,
                    cooldown_secs: 30,
                })
            })
            .clone()
    }
}
