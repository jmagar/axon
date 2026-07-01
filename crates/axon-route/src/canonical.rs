//! Lexical source normalization and source-family detection.

use axon_api::{SourceKind, SourceScope};
use url::Url;

#[derive(Debug, Clone, PartialEq)]
pub struct CanonicalSource {
    pub canonical_uri: String,
    pub source_kind: SourceKind,
    pub default_scope: SourceScope,
    pub adapter_hint: Option<String>,
    pub display_name: String,
    pub reason: String,
}

pub fn canonicalize(raw: &str, requested_scope: Option<SourceScope>) -> Option<CanonicalSource> {
    let source = raw.trim();
    canonical_local(source, requested_scope)
        .or_else(|| canonical_mcp(source))
        .or_else(|| canonical_cli(source))
        .or_else(|| canonical_session(source))
        .or_else(|| canonical_feed(source))
        .or_else(|| canonical_reddit(source))
        .or_else(|| canonical_youtube(source))
        .or_else(|| canonical_registry(source))
        .or_else(|| canonical_github(source))
        .or_else(|| canonical_web(source))
}

fn canonical_local(raw: &str, requested_scope: Option<SourceScope>) -> Option<CanonicalSource> {
    if !(raw.starts_with('/')
        || raw.starts_with("./")
        || raw.starts_with("../")
        || raw.starts_with('~'))
    {
        return None;
    }
    let key = crate::source_id::local_project_key(raw);
    let display_name = raw
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or("local")
        .to_string();
    Some(CanonicalSource {
        canonical_uri: format!("local://{key}"),
        source_kind: SourceKind::Local,
        default_scope: requested_scope.unwrap_or(SourceScope::Directory),
        adapter_hint: Some("local".to_string()),
        display_name,
        reason: "resolved as local filesystem source".to_string(),
    })
}

fn canonical_mcp(raw: &str) -> Option<CanonicalSource> {
    let rest = raw.strip_prefix("mcp:")?;
    let (server, tool) = rest.split_once('/')?;
    Some(basic(
        format!("mcp://{server}/tools/{tool}"),
        SourceKind::McpTool,
        SourceScope::Tool,
        "mcp",
        tool,
        "resolved as MCP tool source",
    ))
}

fn canonical_cli(raw: &str) -> Option<CanonicalSource> {
    let rest = raw.strip_prefix("cli:")?.trim();
    let tool = rest.split_whitespace().next()?;
    Some(basic(
        format!("cli://{tool}"),
        SourceKind::CliTool,
        SourceScope::Tool,
        "cli",
        tool,
        "resolved as CLI tool source",
    ))
}

fn canonical_session(raw: &str) -> Option<CanonicalSource> {
    let rest = raw.strip_prefix("session:")?;
    let (provider, session_id) = rest.split_once(':')?;
    Some(basic(
        format!("session://{provider}/{session_id}"),
        SourceKind::Session,
        SourceScope::Thread,
        "session",
        session_id,
        "resolved as AI session source",
    ))
}

fn canonical_feed(raw: &str) -> Option<CanonicalSource> {
    let feed_url = raw
        .strip_prefix("rss:")
        .or_else(|| raw.strip_prefix("feed:"))
        .or_else(|| raw.strip_prefix("atom:"))?;
    let url = normalized_url(feed_url)?;
    Some(basic(
        format!("feed://{}{}", url.host_str()?, clean_path(&url)),
        SourceKind::Feed,
        SourceScope::Feed,
        "feed",
        url.host_str()?,
        "resolved as feed source",
    ))
}

fn canonical_reddit(raw: &str) -> Option<CanonicalSource> {
    let subreddit = raw
        .strip_prefix("r/")
        .or_else(|| raw.strip_prefix("reddit.com/r/"))
        .or_else(|| raw.strip_prefix("https://reddit.com/r/"))
        .or_else(|| raw.strip_prefix("https://www.reddit.com/r/"))?;
    let name = subreddit.split('/').next()?.trim();
    Some(basic(
        format!("reddit://r/{name}"),
        SourceKind::Reddit,
        SourceScope::Subreddit,
        "reddit",
        name,
        "resolved as Reddit source",
    ))
}

fn canonical_youtube(raw: &str) -> Option<CanonicalSource> {
    let url = normalized_url(raw)?;
    let host = url.host_str()?.trim_start_matches("www.");
    if host == "youtu.be" {
        let id = url.path().trim_start_matches('/');
        return Some(youtube_video(id));
    }
    if host.ends_with("youtube.com") && url.path() == "/watch" {
        let id = url.query_pairs().find(|(key, _)| key == "v")?.1;
        return Some(youtube_video(&id));
    }
    None
}

fn youtube_video(id: &str) -> CanonicalSource {
    basic(
        format!("youtube://video/{id}"),
        SourceKind::Youtube,
        SourceScope::Video,
        "youtube",
        id,
        "resolved as YouTube video source",
    )
}

fn canonical_registry(raw: &str) -> Option<CanonicalSource> {
    let (registry, package) = raw.split_once(':')?;
    let adapter = match registry {
        "crates" | "npm" | "pypi" | "docker" => registry,
        _ => return None,
    };
    let package = if adapter == "pypi" {
        package.to_ascii_lowercase()
    } else {
        package.to_string()
    };
    let canonical_uri = if adapter == "docker" {
        format!("docker://docker.io/{package}")
    } else {
        format!("pkg://{adapter}/{package}")
    };
    Some(basic(
        canonical_uri,
        SourceKind::Registry,
        SourceScope::Package,
        adapter,
        &package,
        "resolved as registry package source",
    ))
}

fn canonical_github(raw: &str) -> Option<CanonicalSource> {
    let path = raw
        .strip_prefix("https://github.com/")
        .or_else(|| raw.strip_prefix("http://github.com/"))
        .or_else(|| raw.strip_prefix("github.com/"))
        .unwrap_or(raw);
    let parts = path.split('/').take(3).collect::<Vec<_>>();
    if parts.len() < 2 || parts[0].contains('.') || parts[0].is_empty() || parts[1].is_empty() {
        return None;
    }
    Some(basic(
        format!("github://{}/{}", parts[0], trim_git_suffix(parts[1])),
        SourceKind::Git,
        SourceScope::Repo,
        "github",
        parts[1],
        "resolved as GitHub repository source",
    ))
}

fn canonical_web(raw: &str) -> Option<CanonicalSource> {
    let url = normalized_url(raw)?;
    Some(basic(
        format!("https://{}{}", url.host_str()?, clean_path(&url)),
        SourceKind::Web,
        SourceScope::Site,
        "web",
        url.host_str()?,
        "resolved as web source",
    ))
}

fn normalized_url(raw: &str) -> Option<Url> {
    let candidate = if raw.contains("://") {
        raw.to_string()
    } else if raw.contains('.') {
        format!("https://{raw}")
    } else {
        return None;
    };
    let mut url = Url::parse(&candidate).ok()?;
    url.set_scheme(&url.scheme().to_ascii_lowercase()).ok()?;
    Some(url)
}

fn clean_path(url: &Url) -> String {
    let path = if url.path().is_empty() {
        "/"
    } else {
        url.path()
    };
    if path == "/" {
        "/".to_string()
    } else {
        path.trim_end_matches('/').to_string()
    }
}

fn trim_git_suffix(value: &str) -> &str {
    value.strip_suffix(".git").unwrap_or(value)
}

fn basic(
    canonical_uri: String,
    source_kind: SourceKind,
    default_scope: SourceScope,
    adapter: &str,
    display_name: &str,
    reason: &str,
) -> CanonicalSource {
    CanonicalSource {
        canonical_uri,
        source_kind,
        default_scope,
        adapter_hint: Some(adapter.to_string()),
        display_name: display_name.to_string(),
        reason: reason.to_string(),
    }
}
