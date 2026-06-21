use axum::{
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use metrics_exporter_prometheus::{PrometheusBuilder, PrometheusHandle};
use std::sync::OnceLock;

static PROMETHEUS_HANDLE: OnceLock<PrometheusHandle> = OnceLock::new();

/// Install the Prometheus recorder once at server startup.
///
/// No-op if called more than once (subsequent calls return without error).
/// Must be called before the `/metrics` route is first hit.
pub(crate) fn install_recorder() {
    PROMETHEUS_HANDLE.get_or_init(|| {
        PrometheusBuilder::new()
            .install_recorder()
            .expect("failed to install Prometheus recorder")
    });
}

pub(super) async fn metrics_handler() -> Response {
    let Some(handle) = PROMETHEUS_HANDLE.get() else {
        return (StatusCode::SERVICE_UNAVAILABLE, "metrics not initialized").into_response();
    };
    let body = handle.render();
    Response::builder()
        .status(StatusCode::OK)
        .header(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/plain; version=0.0.4; charset=utf-8"),
        )
        .body(axum::body::Body::from(body))
        .unwrap_or_else(|_| StatusCode::INTERNAL_SERVER_ERROR.into_response())
}
