use axon_api::source::ApiError;
use url::Url;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct WebUrlParts {
    pub normalized_url: String,
    pub item_key: String,
    pub domain: String,
    pub origin: String,
    pub path: String,
}

impl WebUrlParts {
    pub(super) fn parse(raw: &str) -> Result<Self, ApiError> {
        let mut url = Url::parse(raw).map_err(|err| {
            ApiError::new(
                "adapter.web.url.invalid",
                axon_error::ErrorStage::Normalizing,
                err.to_string(),
            )
            .with_context("url", redacted_url(raw))
        })?;
        if !matches!(url.scheme(), "http" | "https") {
            return Err(ApiError::new(
                "adapter.web.url.unsupported_scheme",
                axon_error::ErrorStage::Normalizing,
                "web adapter only supports http and https URLs",
            )
            .with_context("url", redacted_url(raw)));
        }
        url.set_fragment(None);
        let _ = url.set_username("");
        let _ = url.set_password(None);
        normalize_query(&mut url);

        let domain = url.host_str().unwrap_or_default().to_string();
        let origin = match url.port() {
            Some(port) => format!("{}://{}:{port}", url.scheme(), domain),
            None => format!("{}://{}", url.scheme(), domain),
        };
        let path = clean_path(url.path());
        url.set_path(&path);
        let normalized_url = url.to_string().trim_end_matches('/').to_string();
        let item_key = web_item_key(&path);
        Ok(Self {
            normalized_url,
            item_key,
            domain,
            origin,
            path,
        })
    }
}

fn normalize_query(url: &mut Url) {
    let mut pairs = url
        .query_pairs()
        .filter(|(key, _)| !is_tracking_or_sensitive_query(key))
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect::<Vec<_>>();
    pairs.sort();
    url.set_query(None);
    if !pairs.is_empty() {
        let mut serializer = url.query_pairs_mut();
        for (key, value) in pairs {
            serializer.append_pair(&key, &value);
        }
    }
}

fn is_tracking_or_sensitive_query(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key.starts_with("utm_")
        || matches!(
            key.as_str(),
            "token" | "access_token" | "api_key" | "apikey" | "key" | "signature" | "sig"
        )
}

fn clean_path(path: &str) -> String {
    let path = if path.is_empty() { "/" } else { path };
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
    if collapsed == "/" {
        collapsed
    } else {
        collapsed.trim_end_matches('/').to_string()
    }
}

fn web_item_key(path: &str) -> String {
    let key = path.trim_matches('/');
    if key.is_empty() {
        "index".to_string()
    } else {
        key.to_string()
    }
}

fn redacted_url(raw: &str) -> String {
    raw.split('?').next().unwrap_or(raw).to_string()
}
