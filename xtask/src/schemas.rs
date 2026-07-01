mod artifact;
mod families;
mod registry;
mod source_input;

use std::path::{Path, PathBuf};

use anyhow::{Result, bail};
use clap::{Args, Subcommand, ValueEnum};
use families::{all_families, generator_for};
use serde::Serialize;

#[derive(Debug, Args)]
pub struct SchemasArgs {
    #[command(subcommand)]
    command: SchemaCommand,
}

#[derive(Debug, Subcommand)]
enum SchemaCommand {
    /// Generate every schema family.
    Generate(SchemaGenerateArgs),
    /// Generate/check only the API DTO schema family.
    Api(SchemaGenerateArgs),
    /// Generate/check only the CLI schema family.
    Cli(SchemaGenerateArgs),
    /// Generate/check only the OpenAPI schema family.
    Openapi(SchemaGenerateArgs),
    /// Generate/check only the MCP schema family.
    Mcp(SchemaGenerateArgs),
    /// Generate/check only the config schema family.
    Config(SchemaGenerateArgs),
    /// Generate/check only the event schema family.
    Events(SchemaGenerateArgs),
    /// Generate/check only the error schema family.
    Errors(SchemaGenerateArgs),
    /// Generate/check only the database schema family.
    Database(SchemaGenerateArgs),
    /// Generate/check only the graph schema family.
    Graph(SchemaGenerateArgs),
    /// Generate/check only the vector-payload schema family.
    VectorPayload(SchemaGenerateArgs),
    /// Generate/check only the provider schema family.
    Providers(SchemaGenerateArgs),
}

#[derive(Debug, Args, Clone, Default)]
pub struct SchemaGenerateArgs {
    /// Fail if generated output differs from tracked files.
    #[arg(long)]
    pub check: bool,
    /// Print generated artifacts to stdout instead of writing.
    #[arg(long)]
    pub print: bool,
    /// Emit machine-readable check report.
    #[arg(long)]
    pub json: bool,
    /// Restrict aggregate generate/check to one family.
    #[arg(long, value_enum)]
    pub family: Option<SchemaFamily>,
    /// Regenerate fixture snapshots. Forbidden in CI.
    #[arg(long)]
    pub update_fixtures: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, ValueEnum)]
#[value(rename_all = "kebab-case")]
pub enum SchemaFamily {
    Api,
    Cli,
    Openapi,
    Mcp,
    Config,
    Events,
    Errors,
    Database,
    Graph,
    VectorPayload,
    Providers,
}

impl Serialize for SchemaFamily {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.as_str())
    }
}

impl SchemaFamily {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Api => "api",
            Self::Cli => "cli",
            Self::Openapi => "openapi",
            Self::Mcp => "mcp",
            Self::Config => "config",
            Self::Events => "events",
            Self::Errors => "errors",
            Self::Database => "database",
            Self::Graph => "graph",
            Self::VectorPayload => "vector-payload",
            Self::Providers => "providers",
        }
    }
}

pub fn run(root: &Path, args: SchemasArgs) -> Result<()> {
    match args.command {
        SchemaCommand::Generate(args) => run_families(root, selected_families(args.family), &args),
        SchemaCommand::Api(args) => run_families(root, vec![SchemaFamily::Api], &args),
        SchemaCommand::Cli(args) => run_families(root, vec![SchemaFamily::Cli], &args),
        SchemaCommand::Openapi(args) => run_families(root, vec![SchemaFamily::Openapi], &args),
        SchemaCommand::Mcp(args) => run_families(root, vec![SchemaFamily::Mcp], &args),
        SchemaCommand::Config(args) => run_families(root, vec![SchemaFamily::Config], &args),
        SchemaCommand::Events(args) => run_families(root, vec![SchemaFamily::Events], &args),
        SchemaCommand::Errors(args) => run_families(root, vec![SchemaFamily::Errors], &args),
        SchemaCommand::Database(args) => run_families(root, vec![SchemaFamily::Database], &args),
        SchemaCommand::Graph(args) => run_families(root, vec![SchemaFamily::Graph], &args),
        SchemaCommand::VectorPayload(args) => {
            run_families(root, vec![SchemaFamily::VectorPayload], &args)
        }
        SchemaCommand::Providers(args) => run_families(root, vec![SchemaFamily::Providers], &args),
    }
}

fn selected_families(family: Option<SchemaFamily>) -> Vec<SchemaFamily> {
    family.map_or_else(all_families, |family| vec![family])
}

fn run_families(root: &Path, families: Vec<SchemaFamily>, args: &SchemaGenerateArgs) -> Result<()> {
    if args.update_fixtures && std::env::var_os("CI").is_some() {
        bail!("--update-fixtures is forbidden in CI");
    }

    let mut drift = Vec::new();
    let mut reports = Vec::new();
    for family in families {
        let artifacts = generator_for(family).generate(root)?;
        registry::check_removed_surface_drift(&artifacts)?;
        registry::check_enum_projection_drift(&artifacts)?;
        reports.push(FamilyReport {
            family,
            ok: true,
            artifacts_checked: artifacts.len(),
            drift: Vec::new(),
            warnings: Vec::new(),
        });
        if args.print {
            print_artifacts(&artifacts);
            continue;
        }
        if args.check {
            collect_drift(root, &artifacts, &mut drift)?;
        } else {
            write_artifacts(root, &artifacts)?;
        }
    }

    if !drift.is_empty() {
        bail!("schema artifacts are stale:\n{}", drift.join("\n"));
    }
    if args.json {
        print_report(&reports)?;
    }
    Ok(())
}

#[derive(Debug, Serialize)]
struct FamilyReport {
    family: SchemaFamily,
    ok: bool,
    artifacts_checked: usize,
    drift: Vec<String>,
    warnings: Vec<String>,
}

fn print_report(reports: &[FamilyReport]) -> Result<()> {
    let mut content = serde_json::to_string_pretty(reports)?;
    content.push('\n');
    print!("{content}");
    Ok(())
}

fn print_artifacts(artifacts: &[artifact::SchemaArtifact]) {
    for artifact in artifacts {
        println!("--- {}", artifact.path.display());
        println!("{}", artifact.content);
    }
}

fn collect_drift(
    root: &Path,
    artifacts: &[artifact::SchemaArtifact],
    drift: &mut Vec<String>,
) -> Result<()> {
    for artifact in artifacts {
        let path = root.join(&artifact.path);
        match std::fs::read_to_string(&path) {
            Ok(existing) if existing == artifact.content => {}
            Ok(_) => drift.push(format!(
                "{} differs; run `cargo xtask schemas generate`",
                artifact.path.display()
            )),
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => drift.push(format!(
                "{} is missing; run `cargo xtask schemas generate`",
                artifact.path.display()
            )),
            Err(err) => return Err(err.into()),
        }
    }
    Ok(())
}

fn write_artifacts(root: &Path, artifacts: &[artifact::SchemaArtifact]) -> Result<()> {
    for artifact in artifacts {
        let path = root.join(&artifact.path);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, &artifact.content)?;
    }
    Ok(())
}

fn rel(path: impl Into<PathBuf>) -> PathBuf {
    path.into()
}

#[cfg(test)]
#[path = "schemas/tests.rs"]
mod tests;
