use spider::tokio;
use std::time::Duration;

pub async fn redis_healthy(redis_url: &str) -> bool {
    let client = match redis::Client::open(redis_url) {
        Ok(client) => client,
        Err(_) => return false,
    };

    let ping = async {
        let mut conn = client.get_multiplexed_async_connection().await?;
        redis::cmd("PING")
            .query_async::<String>(&mut conn)
            .await
            .map(|_| ())
    };

    matches!(
        tokio::time::timeout(Duration::from_secs(5), ping).await,
        Ok(Ok(()))
    )
}
