use axon_api::{AuthorityLevel, SourceKind, SourceRequest};

use crate::{AdapterRegistry, AuthorityRecord, InMemoryAuthorityRegistry, SourceResolver};

fn resolver() -> SourceResolver {
    SourceResolver::new(
        InMemoryAuthorityRegistry::default(),
        AdapterRegistry::target_defaults(),
    )
}

#[test]
fn resolver_preserves_non_default_ports_in_canonical_sources() {
    let resolver = resolver();
    let web = resolver
        .resolve(&SourceRequest::new("https://example.com:8443/docs"))
        .expect("web resolves");
    let feed = resolver
        .resolve(&SourceRequest::new("rss:https://example.com:8443/feed.xml"))
        .expect("feed resolves");
    let git = resolver
        .resolve(&SourceRequest::new(
            "https://git.example.com:8443/org/project.git",
        ))
        .expect("git resolves");

    assert_eq!(web.canonical_uri, "https://example.com:8443/docs");
    assert_eq!(feed.canonical_uri, "feed://example.com:8443/feed.xml");
    assert_eq!(
        git.canonical_uri,
        "git+https://git.example.com:8443/org/project.git"
    );
}

#[test]
fn resolver_uses_lexical_local_path_identity_without_requiring_existing_paths() {
    let resolver = resolver();
    let first = resolver
        .resolve(&SourceRequest::local_path(
            "/tmp/axon-route-missing/./nested/../repo",
            true,
        ))
        .expect("first path resolves");
    let second = resolver
        .resolve(&SourceRequest::local_path(
            "/tmp/axon-route-missing/repo/",
            true,
        ))
        .expect("second path resolves");

    assert_eq!(first.canonical_uri, second.canonical_uri);
    assert_eq!(first.source_id, second.source_id);
}

#[test]
fn resolver_does_not_classify_spoofed_provider_hosts() {
    let resolver = resolver();
    let youtube_spoof = resolver
        .resolve(&SourceRequest::new("https://notyoutube.com/watch?v=abc"))
        .expect("spoof host resolves as web");
    let gitlab_spoof = resolver
        .resolve(&SourceRequest::new(
            "https://notgitlab.example.com/org/repo",
        ))
        .expect("spoof host resolves as web");

    assert_eq!(youtube_spoof.source_kind, SourceKind::Web);
    assert_eq!(
        youtube_spoof.canonical_uri,
        "https://notyoutube.com/watch?v=abc"
    );
    assert_eq!(gitlab_spoof.source_kind, SourceKind::Web);
    assert_eq!(
        gitlab_spoof.canonical_uri,
        "https://notgitlab.example.com/org/repo"
    );
}

#[test]
fn resolver_redacts_common_signed_url_query_params() {
    let resolved = resolver()
        .resolve(&SourceRequest::new(
            "https://example.com/file?X-Amz-Signature=abc&sig=def&jwt=ghi&q=rust",
        ))
        .expect("signed URL resolves");

    assert_eq!(
        resolved.canonical_uri,
        "https://example.com/file?X-Amz-Signature=REDACTED&jwt=REDACTED&q=rust&sig=REDACTED"
    );
}

#[test]
fn authority_aliases_preserve_provider_specific_adapter_hints() {
    let resolver = SourceResolver::new(
        InMemoryAuthorityRegistry::from_records(vec![
            AuthorityRecord::new(
                "auth_axon_repo",
                "github://jmagar/axon",
                SourceKind::Git,
                AuthorityLevel::Official,
            )
            .with_alias("axon-repo"),
            AuthorityRecord::new(
                "auth_fastapi_pkg",
                "pkg://pypi/fastapi",
                SourceKind::Registry,
                AuthorityLevel::Official,
            )
            .with_alias("fastapi"),
        ]),
        AdapterRegistry::target_defaults(),
    );

    let github = resolver
        .resolve(&SourceRequest::new("axon-repo"))
        .expect("repo alias resolves");
    let pypi = resolver
        .resolve(&SourceRequest::new("fastapi"))
        .expect("package alias resolves");

    assert_eq!(github.candidate_adapters[0].adapter.name, "github");
    assert_eq!(pypi.candidate_adapters[0].adapter.name, "pypi");
}
