use super::*;
use axon_api::source::*;
use uuid::Uuid;

use fake::{FakeEmbeddingMode, FakeEmbeddingProvider};
use provider::EmbeddingProvider;
use reservation::{ProviderReservationConfig, ProviderReservationManager, ProviderReservations};

fn batch(priority: JobPriority) -> EmbeddingBatch {
    EmbeddingBatch {
        batch_id: BatchId::new(Uuid::from_u128(1)),
        job_id: JobId::new(Uuid::from_u128(2)),
        provider_id: ProviderId::new("fake-embedding"),
        model: "fake-embedding".to_string(),
        items: vec![EmbeddingInput {
            chunk_id: ChunkId::new("chunk-a"),
            text: "hello world".to_string(),
            content_kind: ContentKind::PlainText,
            metadata: MetadataMap::new(),
        }],
        instruction: None,
        priority,
        metadata: MetadataMap::new(),
    }
}

#[tokio::test]
async fn fake_embedding_provider_returns_deterministic_dimensioned_vectors() {
    let provider = FakeEmbeddingProvider::new("fake-embedding", 4);

    let first = provider
        .embed(batch(JobPriority::Background))
        .await
        .unwrap();
    let second = provider
        .embed(batch(JobPriority::Background))
        .await
        .unwrap();

    assert_eq!(first.dimensions, 4);
    assert_eq!(first.vectors, second.vectors);
    assert_eq!(provider.calls().await.len(), 2);
}

#[tokio::test]
async fn fake_embedding_provider_reports_capability_and_health_overrides() {
    let provider = FakeEmbeddingProvider::new("fake-embedding", 8)
        .with_health(HealthStatus::Cooling)
        .with_mode(FakeEmbeddingMode::RateLimited);

    let capability = provider.capabilities().await.unwrap();
    assert_eq!(capability.health, HealthStatus::Cooling);
    assert_eq!(capability.provider_kind, ProviderKind::Embedding);

    let err = provider
        .embed(batch(JobPriority::Interactive))
        .await
        .unwrap_err();
    assert_eq!(err.code.to_string(), "provider.rate_limited");
    assert!(err.retryable);
}

#[tokio::test]
async fn reservations_preserve_interactive_capacity_under_background_load() {
    let reservations = ProviderReservationManager::new(ProviderReservationConfig {
        provider_id: ProviderId::new("fake-embedding"),
        provider_kind: ProviderKind::Embedding,
        capacity: 2,
        interactive_reserve: 1,
        cooldown_after_failures: 1,
        cooldown_secs: 30,
    });

    let _background = reservations
        .reserve(JobPriority::Background, 1)
        .await
        .unwrap();
    let interactive = reservations
        .reserve(JobPriority::Interactive, 1)
        .await
        .unwrap();

    assert_eq!(interactive.priority(), JobPriority::Interactive);
    assert_eq!(reservations.snapshot().await.active, 2);

    let denied = reservations
        .reserve(JobPriority::Background, 1)
        .await
        .unwrap_err();
    assert_eq!(denied.code.to_string(), "provider.capacity_exhausted");
}

#[tokio::test]
async fn background_reservations_account_for_requested_units_before_using_reserve() {
    let reservations = ProviderReservationManager::new(ProviderReservationConfig {
        provider_id: ProviderId::new("fake-embedding"),
        provider_kind: ProviderKind::Embedding,
        capacity: 4,
        interactive_reserve: 2,
        cooldown_after_failures: 1,
        cooldown_secs: 30,
    });

    let denied = reservations
        .reserve(JobPriority::Background, 3)
        .await
        .unwrap_err();

    assert_eq!(denied.code.to_string(), "provider.capacity_exhausted");
    assert_eq!(reservations.snapshot().await.active, 0);
}

#[tokio::test]
async fn reservation_drop_releases_capacity_synchronously() {
    let reservations = ProviderReservationManager::new(ProviderReservationConfig {
        provider_id: ProviderId::new("fake-embedding"),
        provider_kind: ProviderKind::Embedding,
        capacity: 1,
        interactive_reserve: 0,
        cooldown_after_failures: 1,
        cooldown_secs: 30,
    });
    {
        let _held = reservations
            .reserve(JobPriority::Interactive, 1)
            .await
            .unwrap();
        assert_eq!(reservations.snapshot().await.active, 1);
    }

    assert_eq!(reservations.snapshot().await.active, 0);
    reservations
        .reserve(JobPriority::Interactive, 1)
        .await
        .unwrap();
}

#[tokio::test]
async fn compatibility_provider_reservations_keep_legacy_per_provider_api() {
    let reservations = ProviderReservations::new(2, 1);

    let held = reservations
        .reserve(
            ProviderId::new("fake-embedding"),
            JobPriority::Interactive,
            1,
        )
        .await
        .unwrap();

    assert_eq!(held.provider_id(), &ProviderId::new("fake-embedding"));
    assert_eq!(reservations.snapshot().await.active, 1);
}
