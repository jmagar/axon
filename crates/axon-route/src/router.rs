//! Source router boundary.

use axon_api::{
    AdapterOptions, ChunkHint, ChunkProfile, ExecutionAffinity, ParserHint, ProviderRequirement,
    ResolvedSource, RoutePlan, SafetyClass, SourceKind, SourceRequest,
};
use axon_error::{ApiError, ErrorStage};

use crate::capability::{AdapterDefinition, AdapterRegistry};

pub type RouteDecision = RoutePlan;

#[derive(Debug, Clone)]
pub struct SourceRouter {
    adapters: AdapterRegistry,
}

impl SourceRouter {
    pub fn new(adapters: AdapterRegistry) -> Self {
        Self { adapters }
    }

    pub fn route(
        &self,
        request: &SourceRequest,
        source: ResolvedSource,
    ) -> Result<RoutePlan, ApiError> {
        let scope = request.scope.unwrap_or(source.default_scope);
        let adapter = self.select_adapter(request, &source)?;

        if !adapter.supported_scopes.contains(&scope) {
            return Err(ApiError::new(
                "source.scope.unsupported",
                ErrorStage::Routing,
                "adapter does not support requested source scope",
            )
            .with_context("adapter", adapter.adapter.name.clone())
            .with_context("scope", format!("{scope:?}")));
        }
        self.validate_options(request, adapter)?;

        Ok(RoutePlan {
            source,
            adapter: adapter.adapter.clone(),
            scope,
            provider_requirements: provider_requirements(adapter),
            credential_requirements: adapter.credential_requirements.clone(),
            execution_affinity: execution_affinity(adapter),
            safety_class: adapter.safety_class,
            option_schema_id: format!("adapter:{}:options:v1", adapter.adapter.name),
            validated_options: AdapterOptions {
                values: request.options.values.clone(),
            },
            chunking_hints: chunking_hints(adapter.source_kind),
            parser_hints: parser_hints(adapter.source_kind),
            graph_fact_kinds: graph_fact_kinds(adapter.source_kind),
            watch_supported: adapter.watch_supported,
            refresh_supported: adapter.refresh_supported,
        })
    }

    fn select_adapter(
        &self,
        request: &SourceRequest,
        source: &ResolvedSource,
    ) -> Result<&AdapterDefinition, ApiError> {
        if let Some(name) = request.adapter.as_deref() {
            let adapter = self.adapters.find(name).ok_or_else(|| {
                ApiError::new(
                    "route.adapter.unknown",
                    ErrorStage::Routing,
                    "requested adapter is not registered",
                )
                .with_context("adapter", name.to_string())
            })?;
            if adapter.source_kind != source.source_kind {
                return Err(ApiError::new(
                    "route.adapter.unsupported_source",
                    ErrorStage::Routing,
                    "requested adapter does not support resolved source kind",
                )
                .with_context("adapter", name.to_string())
                .with_context("source_kind", format!("{:?}", source.source_kind)));
            }
            return Ok(adapter);
        }

        source
            .candidate_adapters
            .first()
            .and_then(|candidate| self.adapters.find(&candidate.adapter.name))
            .ok_or_else(|| {
                ApiError::new(
                    "route.adapter.missing",
                    ErrorStage::Routing,
                    "no adapter supports resolved source",
                )
            })
    }

    fn validate_options(
        &self,
        request: &SourceRequest,
        adapter: &AdapterDefinition,
    ) -> Result<(), ApiError> {
        for key in request.options.values.keys() {
            if key != "allow_tool_execution" {
                return Err(ApiError::new(
                    "route.options.unsupported",
                    ErrorStage::Routing,
                    "unsupported route option for selected adapter",
                )
                .with_context("adapter", adapter.adapter.name.clone())
                .with_context("option", key.clone()));
            }
        }

        if adapter.safety_class == SafetyClass::ToolExecution {
            let allowed = request
                .options
                .values
                .get("allow_tool_execution")
                .and_then(|value| value.as_bool())
                == Some(true);
            if !allowed {
                return Err(ApiError::new(
                    "route.tool_execution.denied",
                    ErrorStage::Routing,
                    "tool execution sources require explicit allow_tool_execution=true",
                )
                .with_context("adapter", adapter.adapter.name.clone()));
            }
        }

        Ok(())
    }
}

fn execution_affinity(adapter: &AdapterDefinition) -> ExecutionAffinity {
    if adapter.source_kind == SourceKind::CliTool || adapter.source_kind == SourceKind::McpTool {
        ExecutionAffinity::ProviderBound
    } else {
        adapter.execution_affinity
    }
}

fn provider_requirements(adapter: &AdapterDefinition) -> Vec<ProviderRequirement> {
    if !adapter.provider_requirements.is_empty() {
        return adapter.provider_requirements.clone();
    }
    Vec::new()
}

fn chunking_hints(source_kind: SourceKind) -> Vec<ChunkHint> {
    let profile = match source_kind {
        SourceKind::Git | SourceKind::Local => ChunkProfile::CodeAst,
        SourceKind::Session => ChunkProfile::Session,
        SourceKind::Youtube => ChunkProfile::Transcript,
        SourceKind::Registry | SourceKind::McpTool | SourceKind::CliTool | SourceKind::Upload => {
            ChunkProfile::Structured
        }
        _ => ChunkProfile::Markdown,
    };
    vec![ChunkHint {
        profile,
        reason: "route default chunk profile".to_string(),
        options: Default::default(),
    }]
}

fn parser_hints(source_kind: SourceKind) -> Vec<ParserHint> {
    vec![ParserHint {
        parser_id: format!("{source_kind:?}").to_ascii_lowercase(),
        reason: "route default parser".to_string(),
        options: Default::default(),
    }]
}

fn graph_fact_kinds(source_kind: SourceKind) -> Vec<String> {
    match source_kind {
        SourceKind::Git => vec!["repo".to_string(), "package_manifest".to_string()],
        SourceKind::Registry => vec!["package".to_string()],
        SourceKind::CliTool | SourceKind::McpTool => vec!["tool".to_string()],
        _ => vec!["source".to_string()],
    }
}
