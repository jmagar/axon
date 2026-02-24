//! AMQP connection, channel creation, job publishing, and queue management.

use crate::crates::core::config::Config;
use crate::crates::core::content::redact_url;
use anyhow::{Context, Result};
use lapin::types::FieldTable;
use lapin::{Channel, Connection, ConnectionProperties};
use std::time::Duration;
use tokio_executor_trait::Tokio as TokioExecutor;
use tokio_reactor_trait::Tokio as TokioReactor;
use uuid::Uuid;

use super::durable_queue_options;

/// Open an AMQP channel with a 5-second connection timeout and declare the given queue.
///
/// **Warning:** This drops the `Connection`, so the returned channel's backing TCP
/// connection will close asynchronously. Only use this for short-lived operations
/// (health checks, queue_purge). For long-lived consumers, use
/// `open_amqp_connection_and_channel` and keep the `Connection` in scope.
pub async fn open_amqp_channel(cfg: &Config, queue_name: &str) -> Result<Channel> {
    let (_, ch) = open_amqp_connection_and_channel(cfg, queue_name).await?;
    Ok(ch)
}

pub(crate) async fn open_amqp_connection_and_channel(
    cfg: &Config,
    queue_name: &str,
) -> Result<(Connection, Channel)> {
    let props = ConnectionProperties::default()
        .with_executor(TokioExecutor::current())
        .with_reactor(TokioReactor::current());
    let conn = tokio::time::timeout(
        Duration::from_secs(5),
        Connection::connect(&cfg.amqp_url, props),
    )
    .await
    .map_err(|_| {
        anyhow::anyhow!(
            "amqp connect timeout: {} (if running in Docker without published ports, run from same Docker network or expose rabbitmq)",
            redact_url(&cfg.amqp_url)
        )
    })?
    .context("amqp connect failed")?;
    let ch = tokio::time::timeout(Duration::from_secs(5), async {
        let ch = conn.create_channel().await?;
        ch.queue_declare(queue_name, durable_queue_options(), FieldTable::default())
            .await?;
        Ok::<Channel, lapin::Error>(ch)
    })
    .await
    .map_err(|_| anyhow::anyhow!("amqp channel/queue declare timeout for queue={queue_name}"))?
    .context("amqp create channel/declare queue failed")?;
    Ok((conn, ch))
}

/// Publish a job ID to an AMQP queue.
pub async fn enqueue_job(cfg: &Config, queue_name: &str, job_id: Uuid) -> Result<()> {
    use lapin::BasicProperties;
    use lapin::options::BasicPublishOptions;

    let (conn, ch) = open_amqp_connection_and_channel(cfg, queue_name).await?;

    let payload = job_id.to_string();
    ch.basic_publish(
        "",
        queue_name,
        BasicPublishOptions::default(),
        payload.as_bytes(),
        BasicProperties::default(),
    )
    .await?
    .await?;

    // Explicitly close channel then connection so lapin's AMQP CLOSE handshake
    // completes synchronously. Without this, lapin defers cleanup to background
    // tokio tasks that race with #[tokio::main] shutdown.
    // Using ch.close() instead of drop(ch) avoids the "invalid channel state: Closing"
    // log noise that occurs when conn.close() races with an in-flight channel-close frame.
    let _ = ch.close(0, "").await;
    let _ = conn.close(200, "").await;

    Ok(())
}

/// Publish multiple job IDs to an AMQP queue over a single connection.
///
/// More efficient than calling [`enqueue_job`] in a loop — one TCP handshake,
/// N publishes, one CLOSE. Uses publisher confirms so the broker acks every
/// message before we close — follows the official lapin `publisher_confirms` example.
pub async fn batch_enqueue_jobs(cfg: &Config, queue_name: &str, job_ids: &[Uuid]) -> Result<()> {
    use lapin::BasicProperties;
    use lapin::options::{BasicPublishOptions, ConfirmSelectOptions};

    if job_ids.is_empty() {
        return Ok(());
    }

    let (conn, ch) = open_amqp_connection_and_channel(cfg, queue_name).await?;

    // Enable publisher confirms so wait_for_confirms actually tracks acks.
    ch.confirm_select(ConfirmSelectOptions::default())
        .await
        .context("confirm_select failed")?;

    for id in job_ids {
        ch.basic_publish(
            "",
            queue_name,
            BasicPublishOptions::default(),
            id.to_string().as_bytes(),
            BasicProperties::default(),
        )
        .await?;
        // Don't await the confirm here — collect them all at once below.
    }

    // Wait for all broker acks in one pass instead of awaiting each publish individually.
    ch.wait_for_confirms()
        .await
        .context("wait_for_confirms failed")?;
    let _ = ch.close(0, "").await;
    let _ = conn.close(200, "").await;

    Ok(())
}

/// Purge all messages from the named AMQP queue, then explicitly close the
/// channel and connection.
///
/// This is the correct way to purge a queue — unlike [`open_amqp_channel`], it
/// keeps the `Connection` alive for the full duration of the operation.
pub(crate) async fn purge_queue_safe(cfg: &Config, queue_name: &str) -> Result<()> {
    use lapin::options::QueuePurgeOptions;

    let (conn, ch) = open_amqp_connection_and_channel(cfg, queue_name).await?;
    ch.queue_purge(queue_name, QueuePurgeOptions::default())
        .await
        .context("queue_purge failed")?;
    let _ = ch.close(0, "").await;
    let _ = conn.close(200, "").await;
    Ok(())
}
