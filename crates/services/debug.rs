use crate::crates::core::config::Config;
use crate::crates::core::health::build_doctor_report;
use crate::crates::core::http::http_client;
use crate::crates::services::types::DebugResult;
use serde_json::Value;
use std::env;
use std::error::Error;

fn resolve_openai_model(cfg: &Config) -> String {
    if !cfg.openai_model.trim().is_empty() {
        return cfg.openai_model.clone();
    }
    env::var("OPENAI_MODEL").unwrap_or_default()
}

pub async fn debug_report(cfg: &Config, user_context: &str) -> Result<DebugResult, Box<dyn Error>> {
    let doctor_report = build_doctor_report(cfg).await?;

    let openai_base_url = cfg.openai_base_url.trim().trim_end_matches('/').to_string();
    let openai_model = resolve_openai_model(cfg);
    if openai_base_url.is_empty() {
        return Err("OPENAI_BASE_URL is required for debug".into());
    }
    if openai_model.is_empty() {
        return Err("OPENAI_MODEL is required for debug".into());
    }

    let prompt = format!(
        "Analyze this Axon doctor report and provide actionable troubleshooting guidance.\n\
         Prioritize root causes and concrete fix commands.\n\
         Keep it concise and operator-friendly.\n\
         Include:\n\
         1) likely root causes ordered by confidence\n\
         2) exact verification commands\n\
         3) exact remediation commands\n\
         4) what to check next if fixes fail\n\n\
         Optional operator context:\n{}\n\n\
         Doctor report JSON:\n{}",
        if user_context.is_empty() {
            "(none)"
        } else {
            user_context
        },
        serde_json::to_string_pretty(&doctor_report)?
    );

    let client = http_client()?;
    let mut req = client
        .post(format!("{openai_base_url}/chat/completions"))
        .json(&serde_json::json!({
            "model": openai_model,
            "messages": [
                {"role": "system", "content": "You are a senior self-hosted infrastructure debugging assistant. Be precise and avoid generic advice."},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.1
        }));

    if !cfg.openai_api_key.trim().is_empty() {
        req = req.bearer_auth(&cfg.openai_api_key);
    }

    let response = req.send().await?.error_for_status()?;
    let body: Value = response.json().await?;
    let analysis = body["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("(no debug response)");

    Ok(DebugResult {
        payload: serde_json::json!({
            "doctor_report": doctor_report,
            "llm_debug": {
                "model": resolve_openai_model(cfg),
                "base_url": cfg.openai_base_url,
                "analysis": analysis,
            }
        }),
    })
}
