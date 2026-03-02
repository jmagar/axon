use crate::crates::vector::ops::ranking;
use spider::url::Url;
use std::collections::HashMap;

pub(super) const SUPPLEMENTAL_CONTEXT_BUDGET_PCT: usize = 85;
pub(super) const SUPPLEMENTAL_MIN_TOP_CHUNKS_FOR_COVERAGE: usize = 6;
pub(super) const SUPPLEMENTAL_RELEVANCE_BONUS: f64 = 0.05;

pub(super) fn push_context_entry(
    entries: &mut Vec<String>,
    context_char_count: &mut usize,
    entry: String,
    separator: &str,
    max_chars: usize,
) -> bool {
    let projected = if entries.is_empty() {
        entry.len()
    } else {
        *context_char_count + separator.len() + entry.len()
    };
    if projected > max_chars {
        return false;
    }
    entries.push(entry);
    *context_char_count = projected;
    true
}

pub(super) fn should_inject_supplemental(
    context_char_count: usize,
    max_context_chars: usize,
    full_docs_selected: usize,
    top_chunks_selected: usize,
) -> bool {
    if max_context_chars == 0 {
        return false;
    }
    let within_budget =
        context_char_count * 100 < max_context_chars * SUPPLEMENTAL_CONTEXT_BUDGET_PCT;
    let coverage_needs_backfill =
        full_docs_selected == 0 || top_chunks_selected < SUPPLEMENTAL_MIN_TOP_CHUNKS_FOR_COVERAGE;
    within_budget && coverage_needs_backfill
}

pub(super) fn query_requests_low_signal_sources(query_tokens: &[String], raw_query: &str) -> bool {
    if raw_query.to_ascii_lowercase().contains("docs/sessions") {
        return true;
    }
    query_tokens.iter().any(|token| {
        matches!(
            token.as_str(),
            "session" | "sessions" | "log" | "logs" | "history" | "histories"
        )
    })
}

pub(super) fn is_low_signal_source_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    let is_web_url = lower.starts_with("http://") || lower.starts_with("https://");
    lower.contains("/docs/sessions/")
        || lower.contains("docs/sessions/")
        || lower.contains("/.cache/")
        || lower.contains(".cache/")
        || (!is_web_url && lower.contains("/logs/"))
        || (!is_web_url && lower.ends_with(".log"))
}

pub(super) fn url_matches_domain_list(url: &str, domains: &[String]) -> bool {
    if domains.is_empty() {
        return true;
    }
    let host = Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(|h| h.to_ascii_lowercase()));
    let Some(host) = host else {
        return false;
    };
    domains.iter().any(|domain| {
        let normalized = domain.trim().to_ascii_lowercase();
        !normalized.is_empty() && (host == normalized || host.ends_with(&format!(".{normalized}")))
    })
}

fn host_from_url(url: &str) -> Option<String> {
    Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(|h| h.to_ascii_lowercase()))
}

pub(super) fn top_domains(candidates: &[ranking::AskCandidate], limit: usize) -> Vec<String> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    for candidate in candidates {
        if let Some(host) = host_from_url(&candidate.url) {
            *counts.entry(host).or_insert(0) += 1;
        }
    }
    let mut entries = counts.into_iter().collect::<Vec<_>>();
    entries.sort_by(|(domain_a, count_a), (domain_b, count_b)| {
        count_b.cmp(count_a).then_with(|| domain_a.cmp(domain_b))
    });
    entries
        .into_iter()
        .take(limit)
        .map(|(domain, count)| format!("{domain}:{count}"))
        .collect()
}

pub(super) fn authoritative_ratio(candidates: &[ranking::AskCandidate], domains: &[String]) -> f64 {
    if candidates.is_empty() || domains.is_empty() {
        return 0.0;
    }
    let authoritative = candidates
        .iter()
        .filter(|candidate| url_matches_domain_list(&candidate.url, domains))
        .count();
    authoritative as f64 / candidates.len() as f64
}

fn candidate_topical_overlap_count(
    candidate: &ranking::AskCandidate,
    query_tokens: &[String],
) -> usize {
    query_tokens
        .iter()
        .filter(|token| {
            candidate.url_tokens.contains(token.as_str())
                || candidate.chunk_tokens.contains(token.as_str())
        })
        .count()
}

pub(super) fn candidate_has_topical_overlap(
    candidate: &ranking::AskCandidate,
    query_tokens: &[String],
) -> bool {
    if query_tokens.is_empty() {
        return true;
    }
    let overlap = candidate_topical_overlap_count(candidate, query_tokens);
    let coverage = overlap as f64 / query_tokens.len() as f64;
    match query_tokens.len() {
        0 => true,
        1 | 2 => overlap >= 1,
        3 | 4 => overlap >= 2 || coverage >= 0.5,
        _ => overlap >= 2 && coverage >= 0.34,
    }
}
