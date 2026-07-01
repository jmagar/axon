use axon_api::{AuthorityLevel, SafetyClass, SourceKind, SourceRequest, SourceScope};

use crate::{
    AdapterRegistry, AuthorityRecord, InMemoryAuthorityRegistry, SourceResolver, SourceRouter,
};

fn resolver_with_authority() -> SourceResolver {
    SourceResolver::new(
        InMemoryAuthorityRegistry::from_records(vec![
            AuthorityRecord::new(
                "auth_shadcn_docs",
                "https://ui.shadcn.com/docs",
                SourceKind::Web,
                AuthorityLevel::Official,
            )
            .with_alias("shadcn.com")
            .with_entrypoint(SourceScope::Docs, "https://ui.shadcn.com/docs"),
        ]),
        AdapterRegistry::target_defaults(),
    )
}

#[test]
fn resolver_maps_known_alias_to_official_docs_entrypoint() {
    let resolver = resolver_with_authority();
    let mut request = SourceRequest::new("shadcn.com");
    request.scope = Some(SourceScope::Docs);

    let resolved = resolver.resolve(&request).expect("alias resolves");

    assert_eq!(resolved.requested_uri, "shadcn.com");
    assert_eq!(resolved.canonical_uri, "https://ui.shadcn.com/docs");
    assert_eq!(resolved.source_kind, SourceKind::Web);
    assert_eq!(resolved.default_scope, SourceScope::Docs);
    assert_eq!(resolved.authority, AuthorityLevel::Official);
    assert!(resolved.confidence >= 0.9);
    assert!(
        resolved
            .warnings
            .iter()
            .any(|warning| warning.code == "authority.entrypoint_mapped")
    );
}

#[test]
fn resolver_normalizes_source_families_without_fetching_content() {
    let resolver = resolver_with_authority();

    let cases = [
        (
            SourceRequest::new("example.com"),
            SourceKind::Web,
            "https://example.com/",
            SourceScope::Site,
            "web",
        ),
        (
            SourceRequest::new("https://github.com/jmagar/axon"),
            SourceKind::Git,
            "github://jmagar/axon",
            SourceScope::Repo,
            "github",
        ),
        (
            SourceRequest::new("jmagar/axon"),
            SourceKind::Git,
            "github://jmagar/axon",
            SourceScope::Repo,
            "github",
        ),
        (
            SourceRequest::new("crates:serde"),
            SourceKind::Registry,
            "pkg://crates/serde",
            SourceScope::Package,
            "crates",
        ),
        (
            SourceRequest::new("npm:@modelcontextprotocol/sdk"),
            SourceKind::Registry,
            "pkg://npm/@modelcontextprotocol/sdk",
            SourceScope::Package,
            "npm",
        ),
        (
            SourceRequest::new("r/rust"),
            SourceKind::Reddit,
            "reddit://r/rust",
            SourceScope::Subreddit,
            "reddit",
        ),
        (
            SourceRequest::new("https://youtube.com/watch?v=dQw4w9WgXcQ"),
            SourceKind::Youtube,
            "youtube://video/dQw4w9WgXcQ",
            SourceScope::Video,
            "youtube",
        ),
        (
            SourceRequest::new("rss:https://example.com/feed.xml"),
            SourceKind::Feed,
            "feed://example.com/feed.xml",
            SourceScope::Feed,
            "feed",
        ),
        (
            SourceRequest::new("session:claude:abc123"),
            SourceKind::Session,
            "session://claude/abc123",
            SourceScope::Thread,
            "session",
        ),
        (
            SourceRequest::new("cli:rg --help"),
            SourceKind::CliTool,
            "cli://rg",
            SourceScope::Tool,
            "cli",
        ),
        (
            SourceRequest::new("mcp:context7/resolve-library-id"),
            SourceKind::McpTool,
            "mcp://context7/tools/resolve-library-id",
            SourceScope::Tool,
            "mcp",
        ),
    ];

    for (request, source_kind, canonical_uri, default_scope, adapter) in cases {
        let resolved = resolver
            .resolve(&request)
            .unwrap_or_else(|err| panic!("{} should resolve: {err}", request.source));
        assert_eq!(resolved.source_kind, source_kind, "{}", request.source);
        assert_eq!(resolved.canonical_uri, canonical_uri, "{}", request.source);
        assert_eq!(resolved.default_scope, default_scope, "{}", request.source);
        assert_eq!(resolved.candidate_adapters[0].adapter.name, adapter);
    }
}

#[test]
fn resolver_keeps_local_absolute_paths_out_of_public_identity() {
    let resolver = resolver_with_authority();
    let request = SourceRequest::local_path("/home/jmagar/workspace/axon/crates/axon-route", true);

    let resolved = resolver.resolve(&request).expect("local path resolves");

    assert_eq!(resolved.source_kind, SourceKind::Local);
    assert_eq!(resolved.default_scope, SourceScope::Directory);
    assert!(resolved.canonical_uri.starts_with("local://lp_"));
    assert!(!resolved.canonical_uri.contains("/home/jmagar"));
    assert!(resolved.display_name.contains("axon-route"));
}

#[test]
fn router_rejects_unsupported_scope_before_acquisition() {
    let resolver = resolver_with_authority();
    let router = SourceRouter::new(AdapterRegistry::target_defaults());
    let mut request = SourceRequest::new("crates:serde");
    request.scope = Some(SourceScope::Subreddit);
    let resolved = resolver.resolve(&request).expect("source resolves");

    let err = router
        .route(&request, resolved)
        .expect_err("unsupported scope fails before acquisition");

    assert_eq!(err.code.0, "source.scope.unsupported");
    assert_eq!(err.stage, axon_error::ErrorStage::Routing);
}

#[test]
fn router_selects_adapters_deterministically() {
    let registry = AdapterRegistry::from_adapters(vec![
        crate::AdapterDefinition::new("zeta", "1", SourceKind::Web, SourceScope::Site)
            .with_scope(SourceScope::Page),
        crate::AdapterDefinition::new("alpha", "1", SourceKind::Web, SourceScope::Site)
            .with_scope(SourceScope::Page),
    ]);
    let resolver = SourceResolver::new(InMemoryAuthorityRegistry::default(), registry.clone());
    let router = SourceRouter::new(registry);
    let request = SourceRequest::new("example.com");
    let resolved = resolver.resolve(&request).expect("web source resolves");

    let route = router.route(&request, resolved).expect("route resolves");

    assert_eq!(route.adapter.name, "alpha");
    assert_eq!(route.scope, SourceScope::Site);
    assert_eq!(route.safety_class, SafetyClass::PublicNetwork);
    assert!(route.refresh_supported);
}
