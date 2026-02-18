use spider::url::Url;
use std::error::Error;
use std::net::IpAddr;
use std::time::Duration;

pub fn normalize_url(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.is_empty() || trimmed.contains("://") {
        return trimmed.to_string();
    }

    let looks_like_host = trimmed.contains('.')
        || trimmed.starts_with("localhost")
        || trimmed.starts_with("127.0.0.1")
        || trimmed.starts_with("[::1]");
    let has_no_spaces = !trimmed.chars().any(char::is_whitespace);

    if looks_like_host && has_no_spaces {
        format!("https://{trimmed}")
    } else {
        trimmed.to_string()
    }
}

/// Reject URLs that would allow SSRF attacks.
///
/// Blocks:
/// - Non-http/https schemes
/// - Loopback addresses (127.0.0.0/8, ::1)
/// - Link-local addresses (169.254.0.0/16, fe80::/10)
/// - RFC-1918 private ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
/// - `.internal` and `.local` TLDs
pub fn validate_url(url: &str) -> Result<(), Box<dyn Error>> {
    let normalized = normalize_url(url);
    let parsed = Url::parse(&normalized).map_err(|_| format!("invalid URL: {url}"))?;

    match parsed.scheme() {
        "http" | "https" => {}
        s => return Err(format!("blocked URL scheme '{s}': only http/https allowed").into()),
    }

    let host = parsed.host_str().ok_or("URL has no host")?;

    // Block .internal and .local TLDs
    let lower = host.to_ascii_lowercase();
    if lower.ends_with(".internal") || lower.ends_with(".local") {
        return Err(format!("blocked host '{host}': .internal/.local domains not allowed").into());
    }

    // Parse as IP to check for private/loopback/link-local ranges
    if let Ok(ip) = host.parse::<IpAddr>() {
        if ip.is_loopback() {
            return Err(format!("blocked IP '{ip}': loopback address not allowed").into());
        }
        match ip {
            IpAddr::V4(v4) => {
                let [a, b, ..] = v4.octets();
                let octets = v4.octets();
                let is_link_local = octets[0] == 169 && octets[1] == 254;
                let is_private =
                    octets[0] == 10 || (a == 172 && (16..=31).contains(&b)) || octets[0..2] == [192, 168];
                if is_link_local {
                    return Err(format!(
                        "blocked IP '{v4}': link-local address (169.254.x.x) not allowed"
                    )
                    .into());
                }
                if is_private {
                    return Err(format!(
                        "blocked IP '{v4}': private/RFC-1918 address not allowed"
                    )
                    .into());
                }
            }
            IpAddr::V6(v6) => {
                // Block unique-local (fc00::/7) and link-local (fe80::/10)
                let segs = v6.segments();
                let is_unique_local = segs[0] & 0xfe00 == 0xfc00;
                let is_link_local_v6 = segs[0] & 0xffc0 == 0xfe80;
                if is_unique_local || is_link_local_v6 {
                    return Err(format!(
                        "blocked IPv6 '{v6}': private/link-local address not allowed"
                    )
                    .into());
                }
            }
        }
    }

    Ok(())
}

pub fn build_client(timeout_secs: u64) -> Result<reqwest::Client, Box<dyn Error>> {
    Ok(reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()?)
}

pub async fn fetch_html(client: &reqwest::Client, url: &str) -> Result<String, Box<dyn Error>> {
    let normalized = normalize_url(url);
    validate_url(&normalized)?;
    let body = client
        .get(&normalized)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;
    Ok(body)
}
