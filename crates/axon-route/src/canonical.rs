//! Lexical source normalization and source-family detection.

use axon_api::{Severity, SourceKind, SourceScope, SourceWarning};
use url::{Url, form_urlencoded};

#[derive(Debug, Clone, PartialEq)]
pub struct CanonicalSource {
    pub canonical_uri: String,
    pub source_kind: SourceKind,
    pub default_scope: SourceScope,
    pub adapter_hint: Option<String>,
    pub display_name: String,
    pub reason: String,
    pub warnings: Vec<SourceWarning>,
}

pub fn canonicalize(raw: &str, requested_scope: Option<SourceScope>) -> Option<CanonicalSource> {
    let source = raw.trim();
    canonical_local(source, requested_scope)
        .or_else(|| canonical_mcp(source))
        .or_else(|| canonical_cli(source))
        .or_else(|| canonical_session(source))
        .or_else(|| canonical_upload(source))
        .or_else(|| canonical_feed(source))
        .or_else(|| canonical_reddit(source))
        .or_else(|| canonical_youtube(source))
        .or_else(|| canonical_registry(source))
        .or_else(|| canonical_gitlab(source))
        .or_else(|| canonical_gitea(source))
        .or_else(|| crate::github::canonical_github(source))
        .or_else(|| canonical_generic_git(source))
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
    let normalized = crate::local_path::normalize_local_path(raw);
    let key = crate::source_id::local_project_key(&normalized);
    let display_name = normalized
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
        warnings: Vec::new(),
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

fn canonical_upload(raw: &str) -> Option<CanonicalSource> {
    let artifact = raw.strip_prefix("upload:")?.trim();
    if artifact.is_empty() {
        return None;
    }
    Some(basic(
        format!("upload://{artifact}"),
        SourceKind::Upload,
        SourceScope::File,
        "upload",
        artifact,
        "resolved as upload/artifact source",
    ))
}

fn canonical_feed(raw: &str) -> Option<CanonicalSource> {
    let feed_url = raw
        .strip_prefix("rss:")
        .or_else(|| raw.strip_prefix("feed:"))
        .or_else(|| raw.strip_prefix("atom:"))?;
    let url = normalized_url(feed_url)?;
    Some(basic(
        format!("feed://{}{}", host_port(&url)?, clean_path(&url)),
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
    if is_youtube_host(host) && url.path() == "/watch" {
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

fn canonical_gitlab(raw: &str) -> Option<CanonicalSource> {
    let url = normalized_url(raw)?;
    let host = url.host_str()?;
    if !is_gitlab_host(host) {
        return None;
    }
    let path = repo_path(&url)?;
    Some(basic(
        format!("gitlab://{}/{path}", host_port(&url)?),
        SourceKind::Git,
        SourceScope::Repo,
        "gitlab",
        path.rsplit('/').next().unwrap_or(&path),
        "resolved as GitLab repository source",
    ))
}

fn canonical_gitea(raw: &str) -> Option<CanonicalSource> {
    let url = normalized_url(raw)?;
    let host = url.host_str()?;
    if !is_gitea_host(host) {
        return None;
    }
    let path = repo_path(&url)?;
    Some(basic(
        format!("gitea://{}/{path}", host_port(&url)?),
        SourceKind::Git,
        SourceScope::Repo,
        "gitea",
        path.rsplit('/').next().unwrap_or(&path),
        "resolved as Gitea/Forgejo repository source",
    ))
}

fn canonical_generic_git(raw: &str) -> Option<CanonicalSource> {
    let url = normalized_url(raw)?;
    let path = repo_path(&url)?;
    if !path.ends_with(".git") {
        return None;
    }
    Some(basic(
        format!(
            "git+{}://{}{}",
            url.scheme(),
            host_port(&url)?,
            clean_path(&url)
        ),
        SourceKind::Git,
        SourceScope::Repo,
        "git",
        path.rsplit('/').next().unwrap_or(&path),
        "resolved as generic Git repository source",
    ))
}

fn canonical_web(raw: &str) -> Option<CanonicalSource> {
    let url = normalized_url(raw)?;
    let query = normalized_query(&url);
    let mut source = basic(
        format!(
            "{}://{}{}{}",
            url.scheme(),
            host_port(&url)?,
            clean_path(&url),
            query.query
        ),
        SourceKind::Web,
        SourceScope::Site,
        "web",
        url.host_str()?,
        "resolved as web source",
    );
    source.warnings.extend(query.warnings);
    if !raw.contains("://") {
        source.warnings.push(warning(
            "source.inferred.scheme",
            "source did not include a URL scheme; https was inferred",
        ));
    }
    Some(source)
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
    let path = collapse_duplicate_slashes(path);
    if path == "/" {
        path
    } else {
        path.trim_end_matches('/').to_string()
    }
}

fn host_port(url: &Url) -> Option<String> {
    let host = url.host_str()?;
    Some(match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host.to_string(),
    })
}

struct QueryNormalization {
    query: String,
    warnings: Vec<SourceWarning>,
}

fn normalized_query(url: &Url) -> QueryNormalization {
    let mut kept = Vec::new();
    let mut redacted = false;
    for (key, value) in url.query_pairs() {
        let key = key.to_string();
        let value = value.to_string();
        if is_tracking_param(&key) {
            continue;
        }
        if is_sensitive_param(&key) {
            redacted = true;
            kept.push((key, "REDACTED".to_string()));
        } else {
            kept.push((key, value));
        }
    }
    kept.sort();

    let query = if kept.is_empty() {
        String::new()
    } else {
        let mut serializer = form_urlencoded::Serializer::new(String::new());
        for (key, value) in kept {
            serializer.append_pair(&key, &value);
        }
        format!("?{}", serializer.finish())
    };

    let warnings = if redacted {
        vec![warning(
            "source.query.sensitive_redacted",
            "sensitive query parameter values were redacted in canonical URI",
        )]
    } else {
        Vec::new()
    };

    QueryNormalization { query, warnings }
}

fn is_tracking_param(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key.starts_with("utm_")
        || matches!(
            key.as_str(),
            "fbclid" | "gclid" | "msclkid" | "mc_cid" | "mc_eid" | "igshid"
        )
}

fn is_sensitive_param(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key.contains("token")
        || key.contains("secret")
        || key.contains("password")
        || key.contains("signature")
        || key.contains("credential")
        || key == "sig"
        || key == "jwt"
        || key == "key"
        || key == "api_key"
        || key == "apikey"
        || key == "auth"
        || key == "authorization"
}

fn repo_path(url: &Url) -> Option<String> {
    let path = clean_path(url).trim_start_matches('/').to_string();
    let path = path.split("/-/").next().unwrap_or(&path);
    if path.split('/').count() < 2 {
        None
    } else {
        Some(path.to_string())
    }
}

fn collapse_duplicate_slashes(path: &str) -> String {
    let mut collapsed = String::with_capacity(path.len());
    let mut previous_slash = false;
    for ch in path.chars() {
        if ch == '/' {
            if !previous_slash {
                collapsed.push(ch);
            }
            previous_slash = true;
        } else {
            collapsed.push(ch);
            previous_slash = false;
        }
    }
    collapsed
}

fn is_youtube_host(host: &str) -> bool {
    host == "youtube.com" || host.ends_with(".youtube.com")
}

fn is_gitlab_host(host: &str) -> bool {
    host == "gitlab.com" || host.ends_with(".gitlab.com")
}

fn is_gitea_host(host: &str) -> bool {
    host == "codeberg.org"
        || host.ends_with(".codeberg.org")
        || host == "gitea.com"
        || host.ends_with(".gitea.com")
        || host == "forgejo.org"
        || host.ends_with(".forgejo.org")
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
        warnings: Vec::new(),
    }
}

fn warning(code: &str, message: &str) -> SourceWarning {
    SourceWarning {
        code: code.to_string(),
        severity: Severity::Info,
        message: message.to_string(),
        source_item_key: None,
        retryable: false,
    }
}
