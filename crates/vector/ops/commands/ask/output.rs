use crate::crates::core::config::Config;
use crate::crates::core::http::http_client;
use crate::crates::core::logging::log_warn;
use std::error::Error;

use super::super::streaming::{ask_llm_non_streaming, ask_llm_streaming};

pub(crate) async fn ask_llm_answer(
    cfg: &Config,
    _query: &str,
    context: &str,
) -> Result<(String, u128, bool), Box<dyn Error>> {
    let client = http_client()?;
    let llm_started = std::time::Instant::now();
    let stream_to_stdout = !cfg.json_output;

    let (answer_opt, streamed_ok) = {
        let streamed = ask_llm_streaming(cfg, client, _query, context, stream_to_stdout).await;
        match streamed {
            Ok(ans) => (Some(ans), true),
            Err(e) => {
                let err_msg = e.to_string();
                log_warn(&format!(
                    "streaming failed, falling back to non-streaming: {err_msg}"
                ));
                (None, false)
            }
        }
    };

    let answer = if let Some(ans) = answer_opt {
        ans
    } else {
        ask_llm_non_streaming(cfg, client, _query, context).await?
    };

    Ok((
        answer,
        llm_started.elapsed().as_millis(),
        stream_to_stdout && streamed_ok,
    ))
}
