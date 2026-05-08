use super::AxonMcpServer;
use crate::core::config::Config;
use crate::mcp::auth::{
    AuthPolicy, build_auth_layer, build_auth_policy, configured_mcp_http_token,
};
use crate::mcp::cors::cors_middleware;
use crate::web::security::{HostAllowlist, host_validation_middleware};
use axum::{Router, body::Body, extract::State, middleware, middleware::Next, response::Response};
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};
use std::sync::Arc;
use tokio::sync::OnceCell;

pub async fn run_http_server(
    cfg: Config,
    host: &str,
    port: u16,
) -> Result<(), Box<dyn std::error::Error>> {
    let auth_policy = build_auth_policy(host, false).await?;
    let host_allowlist = HostAllowlist::new(host, port, &cfg.mcp_allowed_origins);

    let app =
        mcp_http_router(cfg, host, port, auth_policy)
            .await?
            .layer(middleware::from_fn_with_state(
                host_allowlist,
                host_validation_middleware,
            ));

    tracing::info!(host = %host, port, "mcp_http: server starting");
    let listener = tokio::net::TcpListener::bind((host, port)).await?;
    if let Err(err) = axum::serve(listener, app).await {
        tracing::error!(error = %err, "mcp_http: server exited with error");
        return Err(err.into());
    }
    tracing::info!("mcp_http: server shut down cleanly");
    Ok(())
}

pub async fn run_unified_server(
    cfg: Config,
    host: &str,
    port: u16,
) -> Result<(), Box<dyn std::error::Error>> {
    let auth_policy = build_auth_policy(host, false).await?;
    let host_allowlist = HostAllowlist::new(host, port, &cfg.mcp_allowed_origins);
    let panel = Arc::new(crate::web::PanelRuntimeState::initialize(host, port)?);
    let setup_required = panel.setup_required();
    let cfg_arc = Arc::new(cfg.clone());
    let web_router = crate::web::router(Arc::clone(&cfg_arc), panel);
    let app = mcp_http_router(cfg, host, port, auth_policy)
        .await?
        .merge(web_router)
        .layer(middleware::from_fn_with_state(
            host_allowlist,
            host_validation_middleware,
        ));

    tracing::info!(host = %host, port, "serve: unified web and mcp server starting");
    let listener = tokio::net::TcpListener::bind((host, port)).await?;
    if setup_required {
        open_setup_browser(host, port);
    }
    if let Err(err) = axum::serve(listener, app).await {
        tracing::error!(error = %err, "serve: unified server exited with error");
        return Err(err.into());
    }
    tracing::info!("serve: unified server shut down cleanly");
    Ok(())
}

fn open_setup_browser(host: &str, port: u16) {
    let host = match host.trim() {
        "0.0.0.0" | "::" | "[::]" => "127.0.0.1",
        "" => "127.0.0.1",
        value => value.trim_matches(['[', ']']),
    };
    let url = format!("http://{host}:{port}/");

    #[cfg(target_os = "linux")]
    let command = ("xdg-open", vec![url.as_str()]);
    #[cfg(target_os = "macos")]
    let command = ("open", vec![url.as_str()]);
    #[cfg(target_os = "windows")]
    let command = (
        "rundll32",
        vec!["url.dll,FileProtocolHandler", url.as_str()],
    );

    #[cfg(any(target_os = "linux", target_os = "macos", target_os = "windows"))]
    {
        let (program, args) = command;
        match std::process::Command::new(program)
            .args(args)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
        {
            Ok(_) => tracing::info!(url = %url, "serve: opened setup wizard in browser"),
            Err(err) => tracing::warn!(url = %url, error = %err, "serve: failed to open browser"),
        }
    }
}

async fn mcp_http_router(
    cfg: Config,
    host: &str,
    port: u16,
    auth_policy: AuthPolicy,
) -> Result<Router, Box<dyn std::error::Error>> {
    let cors_cfg = Arc::new(cfg.clone());
    let cfg_arc = Arc::new(cfg);
    let service_context = Arc::new(OnceCell::new());
    AxonMcpServer::new_with_service_context_cell((*cfg_arc).clone(), Arc::clone(&service_context))
        .base_service_context()
        .await
        .map_err(|e| -> Box<dyn std::error::Error> { e.to_string().into() })?;

    // Clone auth_policy into the factory closure so each server instance
    // created by StreamableHttpService carries the correct policy.
    let auth_policy_for_factory = auth_policy.clone();
    let mcp_service: StreamableHttpService<AxonMcpServer, LocalSessionManager> =
        StreamableHttpService::new(
            move || {
                Ok(AxonMcpServer::new_with_service_context_cell(
                    (*cfg_arc).clone(),
                    Arc::clone(&service_context),
                )
                .with_auth_policy(auth_policy_for_factory.clone()))
            },
            Default::default(),
            {
                let mut cfg = StreamableHttpServerConfig::default();
                cfg.stateful_mode = true;
                cfg
            },
        );

    // Compute resource_url from AXON_MCP_PUBLIC_URL (required for OAuth
    // WWW-Authenticate metadata; unused in bearer-only/LoopbackDev modes).
    let resource_url: Option<Arc<str>> = match &auth_policy {
        AuthPolicy::Mounted { .. } => std::env::var("AXON_MCP_PUBLIC_URL")
            .ok()
            .filter(|s| !s.trim().is_empty())
            .map(|u| Arc::from(format!("{}/mcp", u.trim_end_matches('/')))),
        AuthPolicy::LoopbackDev => None,
    };

    let static_token: Option<Arc<str>> = configured_mcp_http_token().map(Arc::from);

    // Apply auth layer (or skip for LoopbackDev).
    let mcp_router = Router::new().nest_service("/mcp", mcp_service);
    let authenticated: Router =
        if let Some(layer) = build_auth_layer(&auth_policy, static_token, resource_url) {
            mcp_router.layer(layer)
        } else {
            mcp_router
        };

    // Mount the OAuth router when OAuth is active. These routes ARE the auth
    // flow and MUST be unauthenticated (no auth layer applied to them).
    //
    // Locked Decision: use lab_auth::routes::router() (full), NOT
    // bearer_only_router() — the full router gates /register on
    // enable_dynamic_registration (set to true in build_auth_policy), so DCR
    // is available for MCP clients (e.g. claude.ai).
    // bearer_only_router() excludes /register unconditionally.
    //
    // Locked Decision: OAuth router only when auth_state: Some(_).
    // Bearer-only (auth_state: None) and LoopbackDev have no OAuth routes.
    let oauth_router: Option<Router> = if let AuthPolicy::Mounted {
        auth_state: Some(ref state_arc),
    } = auth_policy
    {
        tracing::info!(
            "OAuth router mounted: /.well-known/oauth-authorization-server, \
             /.well-known/oauth-protected-resource, /jwks, /authorize, \
             /auth/google/callback, /token, /register"
        );
        Some(lab_auth::routes::router(state_arc.as_ref().clone()))
    } else {
        None
    };

    // Log auth startup status.
    match &auth_policy {
        AuthPolicy::LoopbackDev => tracing::warn!(
            host = %host,
            port,
            "axon: MCP HTTP server starting WITHOUT authentication (loopback dev mode)"
        ),
        AuthPolicy::Mounted { auth_state: None } => tracing::info!(
            host = %host,
            port,
            "axon: MCP HTTP server starting with static bearer auth"
        ),
        AuthPolicy::Mounted {
            auth_state: Some(_),
        } => tracing::info!(
            host = %host,
            port,
            "axon: MCP HTTP server starting with OAuth 2.0 + static bearer dual-mode auth"
        ),
    }

    // Build combined router. The OAuth router is Router<()> (AuthState baked
    // in via with_state inside lab_auth::routes::router). The cors layer is
    // applied at the outermost level.
    let base = match oauth_router {
        Some(oauth) => Router::new().merge(authenticated).merge(oauth),
        None => Router::new().merge(authenticated),
    };

    Ok(base.layer(middleware::from_fn_with_state(
        cors_cfg,
        mcp_http_cors_middleware,
    )))
}

async fn mcp_http_cors_middleware(
    State(cfg): State<Arc<Config>>,
    request: axum::http::Request<Body>,
    next: Next,
) -> Response {
    cors_middleware(request, next, &cfg.mcp_allowed_origins).await
}

#[cfg(test)]
mod tests {
    fn is_loopback(host: &str) -> bool {
        use std::net::IpAddr;
        use std::str::FromStr;
        let h = host.trim();
        if h.eq_ignore_ascii_case("localhost") {
            return true;
        }
        let h = h
            .strip_prefix('[')
            .and_then(|v| v.strip_suffix(']'))
            .unwrap_or(h);
        IpAddr::from_str(h)
            .map(|addr| addr.is_loopback())
            .unwrap_or(false)
    }

    #[test]
    fn mcp_http_bind_loopback_detection_accepts_loopback_hosts() {
        assert!(is_loopback("127.0.0.1"));
        assert!(is_loopback("::1"));
        assert!(is_loopback("[::1]"));
        assert!(is_loopback("localhost"));
    }

    #[test]
    fn mcp_http_bind_loopback_detection_rejects_wildcard_and_remote_hosts() {
        assert!(!is_loopback("0.0.0.0"));
        assert!(!is_loopback("::"));
        assert!(!is_loopback("192.168.1.10"));
        assert!(!is_loopback("axon.example.com"));
    }
}
