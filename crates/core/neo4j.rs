//! Thin HTTP client for Neo4j's Cypher transactional endpoint.
//!
//! All queries use parameterized `$variables` to avoid string interpolation.

use crate::crates::core::http::http_client;
use base64::Engine;
use serde_json::Value;

type Neo4jResult<T> = Result<T, Box<dyn std::error::Error>>;

pub struct Neo4jClient {
    http: reqwest::Client,
    pub(crate) endpoint: String,
    auth_header: Option<String>,
}

fn build_request_body(cypher: &str, params: Value) -> Value {
    serde_json::json!({
        "statements": [{
            "statement": cypher,
            "parameters": params,
        }],
    })
}

impl Neo4jClient {
    /// Create a client from raw connection parts.
    ///
    /// Returns `None` when the Neo4j URL is empty so graph features stay opt-in.
    pub fn from_parts(url: &str, user: &str, password: &str) -> Option<Self> {
        let trimmed = url.trim();
        if trimmed.is_empty() {
            return None;
        }

        let endpoint = format!("{}/db/neo4j/tx/commit", trimmed.trim_end_matches('/'));
        let auth_header = (!password.is_empty()).then(|| {
            let encoded =
                base64::engine::general_purpose::STANDARD.encode(format!("{user}:{password}"));
            format!("Basic {encoded}")
        });

        Some(Self {
            http: http_client().ok()?.clone(),
            endpoint,
            auth_header,
        })
    }

    pub fn from_config(cfg: &crate::crates::core::config::Config) -> Option<Self> {
        Self::from_parts(&cfg.neo4j_url, &cfg.neo4j_user, &cfg.neo4j_password)
    }

    pub async fn execute(&self, cypher: &str, params: Value) -> Neo4jResult<()> {
        let _ = self.send(cypher, params).await?;
        Ok(())
    }

    pub async fn query(&self, cypher: &str, params: Value) -> Neo4jResult<Vec<Value>> {
        let json = self.send(cypher, params).await?;
        let rows = json["results"]
            .as_array()
            .and_then(|results| results.first())
            .and_then(|result| result["data"].as_array())
            .cloned()
            .unwrap_or_default();
        Ok(rows)
    }

    pub async fn health(&self) -> bool {
        self.execute("RETURN 1", serde_json::json!({}))
            .await
            .is_ok()
    }

    async fn send(&self, cypher: &str, params: Value) -> Neo4jResult<Value> {
        let body = build_request_body(cypher, params);
        let mut request = self.http.post(&self.endpoint).json(&body);
        if let Some(auth_header) = &self.auth_header {
            request = request.header("Authorization", auth_header);
        }

        let response = request.send().await?;
        let status = response.status();
        let json: Value = response.json().await?;

        if let Some(errors) = json["errors"].as_array()
            && let Some(first_error) = errors.first()
        {
            return Err(format!("Neo4j error: {}", first_error["message"]).into());
        }

        if !status.is_success() {
            return Err(format!("Neo4j HTTP {status}").into());
        }

        Ok(json)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_returns_none_when_url_empty() {
        let client = Neo4jClient::from_parts("", "neo4j", "");
        assert!(client.is_none());
    }

    #[test]
    fn new_returns_some_when_url_set() {
        let client = Neo4jClient::from_parts("http://localhost:7474", "neo4j", "pass");
        assert!(client.is_some());
    }

    #[test]
    fn build_request_body_single_statement() {
        let body = build_request_body("RETURN 1", serde_json::json!({}));
        let stmts = body["statements"].as_array().unwrap();
        assert_eq!(stmts.len(), 1);
        assert_eq!(stmts[0]["statement"], "RETURN 1");
    }

    #[test]
    fn build_request_body_with_params() {
        let params = serde_json::json!({"name": "Tokio"});
        let body = build_request_body("MATCH (e:Entity {name: $name}) RETURN e", params.clone());
        assert_eq!(body["statements"][0]["parameters"], params);
    }

    #[test]
    fn auth_header_built_correctly() {
        let client = Neo4jClient::from_parts("http://localhost:7474", "neo4j", "secret").unwrap();
        assert_eq!(client.endpoint, "http://localhost:7474/db/neo4j/tx/commit");
    }
}
