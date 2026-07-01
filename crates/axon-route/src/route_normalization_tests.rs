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
fn resolver_preserves_explicit_http_scheme() {
    let resolver = resolver();
    let web = resolver
        .resolve(&SourceRequest::new("http://localhost:8080/docs"))
        .expect("http web resolves");
    let git = resolver
        .resolve(&SourceRequest::new(
            "http://git.example.com/org/project.git",
        ))
        .expect("http git resolves");

    assert_eq!(web.canonical_uri, "http://localhost:8080/docs");
    assert_eq!(
        git.canonical_uri,
        "git+http://git.example.com/org/project.git"
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
fn resolver_preserves_leading_parent_components_in_relative_local_paths() {
    let resolver = resolver();
    let parent = resolver
        .resolve(&SourceRequest::local_path("../repo", true))
        .expect("parent relative path resolves");
    let nested_parent = resolver
        .resolve(&SourceRequest::local_path("../../repo", true))
        .expect("nested parent relative path resolves");
    let local = resolver
        .resolve(&SourceRequest::local_path("./repo", true))
        .expect("local relative path resolves");

    assert_ne!(parent.canonical_uri, local.canonical_uri);
    assert_ne!(nested_parent.canonical_uri, parent.canonical_uri);
    assert_ne!(nested_parent.source_id, local.source_id);
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

#[test]
fn resolver_rejects_ambiguous_authority_aliases() {
    let resolver = SourceResolver::new(
        InMemoryAuthorityRegistry::from_records(vec![
            AuthorityRecord::new(
                "auth_fastapi_pkg",
                "pkg://pypi/fastapi",
                SourceKind::Registry,
                AuthorityLevel::Official,
            )
            .with_alias("fastapi"),
            AuthorityRecord::new(
                "auth_fastapi_docs",
                "https://fastapi.tiangolo.com/",
                SourceKind::Web,
                AuthorityLevel::Official,
            )
            .with_alias("fastapi"),
        ]),
        AdapterRegistry::target_defaults(),
    );

    let err = resolver
        .resolve(&SourceRequest::new("fastapi"))
        .expect_err("duplicate alias is ambiguous");

    assert_eq!(err.code.0, "source.resolve.ambiguous");
}

#[test]
fn resolver_redacts_requested_uri_when_input_contains_url_secrets() {
    let resolved = resolver()
        .resolve(&SourceRequest::new(
            "https://example.com/file?token=abc&q=rust",
        ))
        .expect("secret URL resolves");

    assert_eq!(
        resolved.requested_uri,
        "https://example.com/file?q=rust&token=REDACTED"
    );
    assert!(!resolved.requested_uri.contains("abc"));
}

#[test]
fn resolver_preserves_github_subpath_identity_for_supported_scopes() {
    let resolver = resolver();
    let issue = resolver
        .resolve(&SourceRequest::new(
            "https://github.com/jmagar/axon/issues/308",
        ))
        .expect("issue resolves");
    let pull = resolver
        .resolve(&SourceRequest::new(
            "https://github.com/jmagar/axon/pull/308",
        ))
        .expect("pull resolves");
    let branch = resolver
        .resolve(&SourceRequest::new(
            "https://github.com/jmagar/axon/tree/main",
        ))
        .expect("branch resolves");

    assert_eq!(issue.canonical_uri, "github://jmagar/axon/issues/308");
    assert_eq!(pull.canonical_uri, "github://jmagar/axon/pulls/308");
    assert_eq!(branch.canonical_uri, "github://jmagar/axon/tree/main");
    assert_ne!(issue.source_id, pull.source_id);
}

#[test]
fn resolver_uses_authority_record_confidence() {
    let resolver = SourceResolver::new(
        InMemoryAuthorityRegistry::from_records(vec![
            AuthorityRecord::new(
                "auth_low_confidence_docs",
                "https://example.com/docs",
                SourceKind::Web,
                AuthorityLevel::Official,
            )
            .with_alias("low-docs")
            .with_confidence(0.42),
        ]),
        AdapterRegistry::target_defaults(),
    );

    let resolved = resolver
        .resolve(&SourceRequest::new("low-docs"))
        .expect("authority resolves");

    assert_eq!(resolved.confidence, 0.42);
}

#[test]
fn resolver_rejects_inconsistent_authority_records() {
    let resolver = SourceResolver::new(
        InMemoryAuthorityRegistry::from_records(vec![
            AuthorityRecord::new(
                "auth_bad_docs",
                "local://lp_bad",
                SourceKind::Web,
                AuthorityLevel::Official,
            )
            .with_alias("bad-docs"),
        ]),
        AdapterRegistry::target_defaults(),
    );

    let err = resolver
        .resolve(&SourceRequest::new("bad-docs"))
        .expect_err("inconsistent authority record fails");

    assert_eq!(err.code.0, "source.authority.invalid");
}
