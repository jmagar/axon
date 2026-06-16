use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "xtask", about = "Axon repository maintenance checks")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Run all repository checks.
    Check,
    /// Enforce modern Rust module layout.
    CheckNoModRs,
    /// Verify MCP HTTP transport support.
    CheckMcpHttp,
    /// Reject staged secret env files.
    CheckEnvStaged,
    /// Warn about newly staged unwrap/expect calls.
    CheckUnwraps,
    /// Verify AGENTS.md/GEMINI.md symlinks next to CLAUDE.md files.
    CheckClaudeSymlinks,
    /// Fail if any symlink in the worktree points to a non-existent target.
    CheckBrokenSymlinks,
    /// Scan staged files for secrets and credentials.
    CheckSecrets,
    /// Compatibility check for the CLI component's version-bearing files.
    /// The full multi-component gate is `check-release-versions`.
    CheckVersionSync,
    /// Verify all releasable components have valid versions and changed shipping paths have bumps.
    CheckReleaseVersions {
        #[arg(long)]
        base: Option<String>,
        #[arg(long, default_value = "HEAD")]
        head: String,
        #[arg(long, value_parser = ["pr", "main"], default_value = "pr")]
        mode: String,
        #[arg(long)]
        json: bool,
    },
    /// Print the release plan consumed by GitHub Actions.
    ReleasePlan {
        #[arg(long)]
        base: Option<String>,
        #[arg(long, default_value = "HEAD")]
        head: String,
        #[arg(long)]
        json: bool,
    },
    /// Bump all version-bearing files for one component.
    BumpVersion {
        component: String,
        #[arg(value_parser = ["patch", "minor", "major"])]
        level: String,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let root = std::env::current_dir()?;
    match cli.command {
        Command::Check => checks::check(&root),
        Command::CheckNoModRs => checks::no_mod_rs::check(&root),
        Command::CheckMcpHttp => checks::mcp_http::check(&root),
        Command::CheckEnvStaged => checks::env_staged::check(&root),
        Command::CheckUnwraps => checks::unwraps::check(&root),
        Command::CheckClaudeSymlinks => checks::claude_symlinks::check(&root),
        Command::CheckBrokenSymlinks => checks::broken_symlinks::check(&root),
        Command::CheckSecrets => checks::secrets::check(&root),
        Command::CheckVersionSync => checks::version_sync::check(&root),
        Command::CheckReleaseVersions {
            base,
            head,
            mode,
            json,
        } => {
            let mode = match mode.as_str() {
                "pr" => checks::release_versions::GateMode::Pr,
                "main" => checks::release_versions::GateMode::Main,
                _ => unreachable!(),
            };
            checks::release_versions::check(&root, base.as_deref(), &head, mode, json)
        }
        Command::ReleasePlan { base, head, json } => {
            let plans = checks::release_versions::plan(&root, base.as_deref(), &head)?;
            if json {
                println!("{}", serde_json::to_string_pretty(&plans)?);
            } else {
                for plan in plans {
                    println!(
                        "{} changed={} version={} tag={} workflow={}",
                        plan.id,
                        plan.changed,
                        plan.version,
                        plan.candidate_tag,
                        plan.release_workflow
                    );
                }
            }
            Ok(())
        }
        Command::BumpVersion { component, level } => {
            let level = match level.as_str() {
                "patch" => checks::release_versions::BumpLevel::Patch,
                "minor" => checks::release_versions::BumpLevel::Minor,
                "major" => checks::release_versions::BumpLevel::Major,
                _ => unreachable!(),
            };
            checks::release_versions::bump(&root, &component, level)
        }
    }
}

mod checks;
