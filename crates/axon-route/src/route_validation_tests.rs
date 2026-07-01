use axon_api::{SafetyClass, SourceKind, SourceRequest, SourceScope};

use crate::{
    AdapterRegistry, InMemoryAuthorityRegistry, RouteSecurityPolicy, SourceResolver, SourceRouter,
};

fn resolver() -> SourceResolver {
    SourceResolver::new(
        InMemoryAuthorityRegistry::default(),
        AdapterRegistry::target_defaults(),
    )
}

#[test]
fn router_rejects_unknown_route_options() {
    let resolver = resolver();
    let router = SourceRouter::new(AdapterRegistry::target_defaults());
    let mut request = SourceRequest::new("example.com");
    request
        .options
        .values
        .insert("definitely_not_valid".to_string(), true.into());
    let resolved = resolver.resolve(&request).expect("source resolves");

    let err = router
        .route(&request, resolved)
        .expect_err("unknown route option fails");

    assert_eq!(err.code.0, "route.options.unsupported");
    assert_eq!(err.stage, axon_error::ErrorStage::Routing);
}

#[test]
fn router_requires_explicit_tool_execution_allowance() {
    let resolver = resolver();
    let router = SourceRouter::new(AdapterRegistry::target_defaults());
    let request = SourceRequest::new("mcp:context7/resolve-library-id");
    let resolved = resolver.resolve(&request).expect("mcp source resolves");

    let err = router
        .route(&request, resolved)
        .expect_err("tool execution needs explicit opt-in");

    assert_eq!(err.code.0, "route.tool_execution.denied");
    assert_eq!(err.stage, axon_error::ErrorStage::Routing);
}

#[test]
fn router_reports_credentials_required_by_adapter() {
    let resolver = resolver();
    let router = SourceRouter::new(AdapterRegistry::target_defaults());
    let request = SourceRequest::new("r/rust");
    let resolved = resolver.resolve(&request).expect("reddit source resolves");

    let route = router.route(&request, resolved).expect("reddit routes");

    assert_eq!(route.adapter.name, "reddit");
    assert!(
        route
            .credential_requirements
            .iter()
            .any(|requirement| requirement.required)
    );
}

#[test]
fn router_rejects_caller_controlled_tool_execution_option() {
    let resolver = resolver();
    let router = SourceRouter::new(AdapterRegistry::target_defaults());
    let mut request = SourceRequest::new("cli:repomix --help");
    request
        .options
        .values
        .insert("allow_tool_execution".to_string(), true.into());
    let resolved = resolver.resolve(&request).expect("cli source resolves");

    let err = router
        .route(&request, resolved)
        .expect_err("public option does not authorize tool execution");

    assert_eq!(err.code.0, "route.options.unsupported");
}

#[test]
fn router_allows_tool_execution_with_trusted_policy() {
    let resolver = resolver();
    let router = SourceRouter::new(AdapterRegistry::target_defaults());
    let request = SourceRequest::new("cli:repomix --help");
    let resolved = resolver.resolve(&request).expect("cli source resolves");

    let route = router
        .route_with_policy(
            &request,
            resolved,
            RouteSecurityPolicy {
                allow_tool_execution: true,
            },
        )
        .expect("trusted policy allows cli route");

    assert_eq!(route.adapter.name, "cli");
    assert_eq!(route.safety_class, SafetyClass::ToolExecution);
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
