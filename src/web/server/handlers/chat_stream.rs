use crate::core::config::Config;
use crate::core::llm;
use crate::services::client_contract::RestChatRequest;
use axum::{
    Extension, Json,
    response::{
        IntoResponse, Response,
        sse::{Event, Sse},
    },
};
use futures_util::Stream;
use serde::Serialize;
use std::{
    convert::Infallible,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    task::{Context, Poll},
};
use tokio::{sync::mpsc, task::JoinHandle};

const SSE_EVENT_BUFFER: usize = 32;

struct AbortOnDropStream {
    rx: mpsc::Receiver<Result<Event, Infallible>>,
    handle: JoinHandle<()>,
}

impl Stream for AbortOnDropStream {
    type Item = Result<Event, Infallible>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        Pin::new(&mut self.rx).poll_recv(cx)
    }
}

impl Drop for AbortOnDropStream {
    fn drop(&mut self) {
        self.handle.abort();
    }
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum ChatStreamEvent {
    Meta { phase: &'static str },
    Delta { text: String },
    Done { answer: String },
    Error { message: String },
}

fn sse_json(event_name: &'static str, value: &ChatStreamEvent) -> Event {
    Event::default()
        .event(event_name)
        .json_data(value)
        .unwrap_or_else(|_| {
            Event::default()
                .event("error")
                .data("{\"type\":\"error\",\"message\":\"encode failed\"}")
        })
}

#[utoipa::path(
    post,
    path = "/v1/chat/stream",
    request_body = RestChatRequest,
    responses(
        (status = 200, description = "Direct LLM chat answer streamed as server-sent events", body = String, content_type = "text/event-stream"),
        (status = 400, description = "Invalid chat request", body = crate::web::server::error::ErrorBody),
        (status = 413, description = "Chat request exceeds limits", body = crate::web::server::error::ErrorBody)
    ),
    tag = "rag"
)]
pub async fn v1_chat_stream(
    Extension(cfg): Extension<Arc<Config>>,
    Json(req): Json<RestChatRequest>,
) -> Response {
    if let Err(err) = super::chat::validate_chat_message(&req.message) {
        return err.into_response();
    }

    let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(SSE_EVENT_BUFFER);
    let disconnected = Arc::new(AtomicBool::new(false));
    let req_cfg = (*cfg).clone();

    let handle = tokio::spawn(async move {
        if tx
            .send(Ok(sse_json(
                "meta",
                &ChatStreamEvent::Meta { phase: "chatting" },
            )))
            .await
            .is_err()
        {
            disconnected.store(true, Ordering::Relaxed);
            return;
        }

        let delta_disconnected = Arc::clone(&disconnected);
        let delta_tx = tx.clone();
        let request = super::chat::completion_request(&req_cfg, &req.message, true);
        let result = llm::complete_streaming(request, move |text| {
            if delta_disconnected.load(Ordering::Relaxed) {
                return Ok(());
            }
            match delta_tx.try_send(Ok(sse_json(
                "delta",
                &ChatStreamEvent::Delta {
                    text: text.to_string(),
                },
            ))) {
                Ok(()) => {}
                Err(mpsc::error::TrySendError::Full(_)) => {
                    return Err("stream backpressure exceeded".into());
                }
                Err(mpsc::error::TrySendError::Closed(_)) => {
                    delta_disconnected.store(true, Ordering::Relaxed);
                }
            }
            Ok(())
        })
        .await
        .map_err(|err| err.to_string());

        if disconnected.load(Ordering::Relaxed) {
            return;
        }

        match result {
            Ok(completion) => {
                if tx
                    .send(Ok(sse_json(
                        "done",
                        &ChatStreamEvent::Done {
                            answer: completion.text,
                        },
                    )))
                    .await
                    .is_err()
                {
                    disconnected.store(true, Ordering::Relaxed);
                }
            }
            Err(message) => {
                if tx
                    .send(Ok(sse_json("error", &ChatStreamEvent::Error { message })))
                    .await
                    .is_err()
                {
                    disconnected.store(true, Ordering::Relaxed);
                }
            }
        }
    });

    let event_stream = AbortOnDropStream { rx, handle };
    Sse::new(event_stream).into_response()
}

#[cfg(test)]
pub(super) fn sse_event_buffer_for_tests() -> usize {
    SSE_EVENT_BUFFER
}

#[cfg(test)]
pub(super) fn bounded_stream_for_tests(
    rx: mpsc::Receiver<Result<Event, Infallible>>,
    handle: JoinHandle<()>,
) -> impl Stream<Item = Result<Event, Infallible>> {
    AbortOnDropStream { rx, handle }
}

#[cfg(test)]
pub(super) async fn v1_chat_stream_test_response(body: serde_json::Value) -> Response {
    let req = serde_json::from_value::<RestChatRequest>(body).expect("valid chat request");
    v1_chat_stream(Extension(Arc::new(Config::default())), Json(req)).await
}

#[cfg(test)]
#[path = "chat_stream_tests.rs"]
mod tests;
