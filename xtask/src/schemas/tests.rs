use std::path::Path;

use tempfile::TempDir;

use super::*;

fn fixture_repo() -> TempDir {
    let tmp = TempDir::new().unwrap();
    for path in [
        "crates/axon-api/src/source.rs",
        "crates/axon-api/src/source/lifecycle.rs",
        "crates/axon-api/src/source/enums.rs",
        "crates/axon-api/src/source/stage.rs",
        "crates/axon-api/src/source/capability.rs",
        "crates/axon-error/src/lib.rs",
        "crates/axon-error/src/api_error.rs",
        "crates/axon-error/src/code.rs",
        "crates/axon-error/src/stage.rs",
        "crates/axon-cli/src/lib.rs",
        "crates/axon-core/src/config/types.rs",
        "crates/axon-web/src/lib.rs",
        "crates/axon-mcp/src/lib.rs",
        "crates/axon-observe/src/lib.rs",
        "crates/axon-graph/src/lib.rs",
        "crates/axon-vectors/src/lib.rs",
        "docs/pipeline-unification/runtime/error-handling.md",
        "docs/pipeline-unification/surfaces/command-contract.md",
        "docs/pipeline-unification/surfaces/rest-contract.md",
        "docs/pipeline-unification/surfaces/tool-contract.md",
        "docs/pipeline-unification/configuration/config-contract.md",
        "docs/pipeline-unification/runtime/observability-contract.md",
        "docs/pipeline-unification/runtime/schema-contract.md",
        "docs/pipeline-unification/sources/source-graph.md",
        "docs/pipeline-unification/schemas/vector-payload-schema.md",
        "docs/pipeline-unification/runtime/provider-contract.md",
    ] {
        write_fixture(tmp.path(), path, "fixture");
    }
    write_fixture(
        tmp.path(),
        "crates/axon-jobs/src/migrations/0001.sql",
        "create table jobs(id text);",
    );
    tmp
}

fn write_fixture(root: &Path, path: &str, content: &str) {
    let path = root.join(path);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, content).unwrap();
}

fn generate(root: &Path) -> Result<()> {
    run(
        root,
        SchemasArgs {
            command: SchemaCommand::Generate(SchemaGenerateArgs::default()),
        },
    )
}

fn check(root: &Path) -> Result<()> {
    run(
        root,
        SchemasArgs {
            command: SchemaCommand::Generate(SchemaGenerateArgs {
                check: true,
                ..SchemaGenerateArgs::default()
            }),
        },
    )
}

#[test]
fn check_fails_when_artifacts_are_missing() {
    let tmp = fixture_repo();
    let err = check(tmp.path()).expect_err("missing artifacts should fail");
    assert!(err.to_string().contains("schema artifacts are stale"));
    assert!(err.to_string().contains("docs/reference/api/schemas.json"));
}

#[test]
fn generate_writes_all_required_family_artifacts() {
    let tmp = fixture_repo();
    generate(tmp.path()).unwrap();

    for path in [
        "docs/reference/api/schemas.json",
        "docs/reference/api/dto.md",
        "docs/reference/api/enums.md",
        "docs/reference/api/errors.schema.json",
        "docs/reference/api/errors.md",
        "docs/reference/cli/commands.json",
        "docs/reference/cli/commands.md",
        "docs/reference/cli/axon-help.md",
        "docs/reference/rest/openapi.json",
        "docs/reference/rest/openapi.md",
        "docs/reference/rest/schemas.md",
        "docs/reference/mcp/tool-schema.json",
        "crates/axon-mcp/tests/golden/tool-schema.json",
        "docs/reference/mcp/tool-schema.md",
        "docs/reference/config/config.schema.json",
        "docs/reference/config/env.schema.json",
        "docs/reference/config/config-toml.md",
        "docs/reference/config/env.md",
        "docs/reference/runtime/events.schema.json",
        "docs/reference/runtime/events.md",
        "docs/reference/runtime/database-schema.json",
        "docs/reference/runtime/database-schema.md",
        "docs/reference/sources/graph.schema.json",
        "docs/reference/sources/graph.md",
        "docs/reference/sources/vector-payload.schema.json",
        "docs/reference/sources/vector-payload.md",
        "docs/reference/runtime/provider-capabilities.schema.json",
        "docs/reference/runtime/provider-capabilities.md",
    ] {
        assert!(tmp.path().join(path).exists(), "{path} should be generated");
    }
}

#[test]
fn generated_json_contains_source_input_checksums_and_canonical_enums() {
    let tmp = fixture_repo();
    generate(tmp.path()).unwrap();
    let content =
        std::fs::read_to_string(tmp.path().join("docs/reference/api/schemas.json")).unwrap();
    let value: serde_json::Value = serde_json::from_str(&content).unwrap();

    let inputs = value["x-axon"]["source_inputs"].as_array().unwrap();
    assert!(inputs.iter().any(|input| {
        input["path"] == "crates/axon-api/src/source.rs"
            && input["sha256"].as_str().unwrap().len() == 64
    }));
    assert_eq!(
        value["$defs"]["enums"]["SourceKind"]["enum"][0],
        serde_json::json!("web")
    );
    assert_eq!(
        value["$defs"]["enums"]["PipelinePhase"]["enum"][1],
        serde_json::json!("requested")
    );
}

#[test]
fn check_passes_after_generation_and_fails_after_stale_artifact() {
    let tmp = fixture_repo();
    generate(tmp.path()).unwrap();
    check(tmp.path()).unwrap();

    let path = tmp.path().join("docs/reference/api/schemas.json");
    let mut content = std::fs::read_to_string(&path).unwrap();
    content.push_str("\n");
    std::fs::write(path, content).unwrap();

    let err = check(tmp.path()).expect_err("stale artifact should fail");
    assert!(
        err.to_string()
            .contains("docs/reference/api/schemas.json differs")
    );
}

#[test]
fn removed_surface_drift_fails_generation() {
    let artifacts = vec![artifact::SchemaArtifact::new(
        "docs/reference/api/schemas.json",
        "{\"title\":\"EmbedRequest\"}",
    )];
    let err = registry::check_removed_surface_drift(&artifacts)
        .expect_err("removed surface token should fail");
    assert!(err.to_string().contains("removed public surface token"));
}
