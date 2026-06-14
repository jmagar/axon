use crate::core::config::Config;
use crate::core::http::http_client;
use crate::core::ui::{accent, muted, primary};
use flate2::read::GzDecoder;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::env;
use std::error::Error;
use std::fmt;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};
use tar::Archive;

const DEFAULT_REPO: &str = "jmagar/axon";
const UPDATE_FILE_RELEASE_DIR: &str = "AXON_UPDATE_FILE_RELEASE_DIR";
const UPDATE_INSTALL_PATH: &str = "AXON_UPDATE_INSTALL_PATH";
const DEV_TARGET_DIR: &str = "AXON_DEV_TARGET_DIR";

#[derive(Debug, Clone, PartialEq, Eq)]
struct ReleaseAssetNames {
    archive: &'static str,
    checksum: &'static str,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Clone)]
struct UpdateOptions {
    repo: String,
    version: Option<String>,
    force: bool,
    sync_container: bool,
    install_path: PathBuf,
    file_release_dir: Option<PathBuf>,
}

#[derive(Debug, Clone)]
struct UpdateReport {
    version: String,
    install_path: PathBuf,
    installed: bool,
    container_synced: bool,
}

#[derive(Debug, PartialEq, Eq)]
struct SyncCommand {
    program: &'static str,
    args: Vec<String>,
    env_name: &'static str,
    env_value: PathBuf,
}

#[derive(Debug)]
struct UpdateError(String);

impl fmt::Display for UpdateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl Error for UpdateError {}

fn err(message: impl Into<String>) -> Box<dyn Error> {
    Box::new(UpdateError(message.into()))
}

pub async fn run_update(cfg: &Config) -> Result<(), Box<dyn Error>> {
    let options = parse_update_options(cfg)?;
    let report = perform_update(options).await?;

    if cfg.json_output {
        let json = serde_json::to_string_pretty(&serde_json::json!({
            "version": report.version,
            "install_path": report.install_path,
            "installed": report.installed,
            "container_synced": report.container_synced,
        }))?;
        println!("{json}");
    } else {
        if report.installed {
            println!("{}", primary(&format!("installed axon {}", report.version)));
        } else {
            println!(
                "{}",
                muted(&format!("axon {} already installed", report.version))
            );
        }
        println!("{} {}", accent("path:"), report.install_path.display());
        if report.container_synced {
            println!("{}", primary("container synced"));
        } else {
            println!("{}", muted("container sync skipped"));
        }
    }

    Ok(())
}

fn parse_update_options(cfg: &Config) -> Result<UpdateOptions, Box<dyn Error>> {
    let mut repo = DEFAULT_REPO.to_string();
    let mut version = None;
    let mut force = false;
    let mut sync_container = true;

    let mut args = cfg.positional.iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--repo" => {
                repo = args
                    .next()
                    .ok_or_else(|| err("--repo requires a value"))?
                    .to_string();
            }
            "--version" => {
                version = Some(
                    args.next()
                        .ok_or_else(|| err("--version requires a value"))?
                        .to_string(),
                );
            }
            "--force" => force = true,
            "--no-container" => sync_container = false,
            other => return Err(err(format!("unknown update argument: {other}"))),
        }
    }

    let install_path = env::var_os(UPDATE_INSTALL_PATH)
        .map(PathBuf::from)
        .unwrap_or_else(default_install_path);

    Ok(UpdateOptions {
        repo,
        version,
        force,
        sync_container,
        install_path,
        file_release_dir: env::var_os(UPDATE_FILE_RELEASE_DIR).map(PathBuf::from),
    })
}

fn default_install_path() -> PathBuf {
    env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".local/bin/axon")
}

async fn perform_update(options: UpdateOptions) -> Result<UpdateReport, Box<dyn Error>> {
    let names = release_asset_names(env::consts::OS, env::consts::ARCH)?;
    let temp = tempfile::tempdir()?;

    let (version, archive_bytes, checksum_body) = if let Some(dir) = &options.file_release_dir {
        let archive = fs::read(dir.join(names.archive))?;
        let checksum = fs::read_to_string(dir.join(names.checksum))?;
        (
            options
                .version
                .clone()
                .unwrap_or_else(|| "local-test-release".to_string()),
            archive,
            checksum,
        )
    } else {
        download_release_assets(&options.repo, options.version.as_deref(), &names).await?
    };

    let expected = parse_sha256_sidecar(&checksum_body)?;
    verify_sha256(&archive_bytes, &expected)?;

    let already_current =
        !options.force && installed_binary_reports_version(&options.install_path, &version);
    if !already_current {
        let extracted = extract_axon_binary(&archive_bytes, temp.path())?;
        install_binary_atomically(&extracted, &options.install_path)?;
    }

    let mut container_synced = false;
    if options.sync_container {
        sync_container_from_installed_binary(&options.install_path)?;
        container_synced = true;
    }

    Ok(UpdateReport {
        version,
        install_path: options.install_path,
        installed: !already_current,
        container_synced,
    })
}

async fn download_release_assets(
    repo: &str,
    version: Option<&str>,
    names: &ReleaseAssetNames,
) -> Result<(String, Vec<u8>, String), Box<dyn Error>> {
    let client = http_client()?;
    let api_url = match version {
        Some(tag) => format!("https://api.github.com/repos/{repo}/releases/tags/{tag}"),
        None => format!("https://api.github.com/repos/{repo}/releases/latest"),
    };

    let release: GithubRelease = client
        .get(&api_url)
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;

    let archive_url = find_asset_url(&release, names.archive)?;
    let checksum_url = find_asset_url(&release, names.checksum)?;
    let archive = client
        .get(archive_url)
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?
        .to_vec();
    let checksum = client
        .get(checksum_url)
        .send()
        .await?
        .error_for_status()?
        .text()
        .await?;

    Ok((release.tag_name, archive, checksum))
}

fn find_asset_url<'a>(release: &'a GithubRelease, name: &str) -> Result<&'a str, Box<dyn Error>> {
    release
        .assets
        .iter()
        .find(|asset| asset.name == name)
        .map(|asset| asset.browser_download_url.as_str())
        .ok_or_else(|| {
            err(format!(
                "release {} is missing asset {name}",
                release.tag_name
            ))
        })
}

fn release_asset_names(os: &str, arch: &str) -> Result<ReleaseAssetNames, Box<dyn Error>> {
    match (os, arch) {
        ("linux", "x86_64") => Ok(ReleaseAssetNames {
            archive: "axon-linux-x86_64.tar.gz",
            checksum: "axon-linux-x86_64.tar.gz.sha256",
        }),
        _ => Err(err(format!(
            "unsupported platform for axon update: {os}/{arch}; only linux/x86_64 is wired"
        ))),
    }
}

fn parse_sha256_sidecar(body: &str) -> Result<String, Box<dyn Error>> {
    let hash = body
        .split_whitespace()
        .next()
        .ok_or_else(|| err("empty sha256 sidecar"))?;
    if hash.len() != 64 || !hash.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(err(format!("invalid sha256 sidecar hash: {hash}")));
    }
    Ok(hash.to_ascii_lowercase())
}

fn verify_sha256(bytes: &[u8], expected: &str) -> Result<(), Box<dyn Error>> {
    let actual = hex::encode(Sha256::digest(bytes));
    if actual != expected.to_ascii_lowercase() {
        return Err(err(format!(
            "checksum mismatch: expected {expected}, got {actual}"
        )));
    }
    Ok(())
}

fn extract_axon_binary(archive_bytes: &[u8], temp_dir: &Path) -> Result<PathBuf, Box<dyn Error>> {
    let gz = GzDecoder::new(Cursor::new(archive_bytes));
    let mut archive = Archive::new(gz);

    for entry in archive.entries()? {
        let mut entry = entry?;
        let path = entry.path()?;
        if path.as_ref() == Path::new("axon") {
            let output = temp_dir.join("axon");
            entry.unpack(&output)?;
            return Ok(output);
        }
    }

    Err(err("release archive did not contain executable axon"))
}

fn install_binary_atomically(source: &Path, dest: &Path) -> Result<(), Box<dyn Error>> {
    let parent = dest
        .parent()
        .ok_or_else(|| err(format!("install path has no parent: {}", dest.display())))?;
    fs::create_dir_all(parent)?;

    let temp_dest = parent.join(format!(
        ".{}.tmp-{}-{}",
        dest.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("axon"),
        std::process::id(),
        unique_suffix()
    ));

    fs::copy(source, &temp_dest)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(&temp_dest)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&temp_dest, permissions)?;
    }
    fs::rename(&temp_dest, dest)?;
    Ok(())
}

fn unique_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

fn installed_binary_reports_version(installed_binary: &Path, version: &str) -> bool {
    if !installed_binary.is_file() {
        return false;
    }
    let Ok(output) = Command::new(installed_binary).arg("--version").output() else {
        return false;
    };
    if !output.status.success() {
        return false;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let normalized = version.trim_start_matches('v');
    stdout.contains(version)
        || stderr.contains(version)
        || stdout.contains(normalized)
        || stderr.contains(normalized)
}

fn build_container_sync_command(installed_binary: &Path) -> Result<SyncCommand, Box<dyn Error>> {
    let bin_dir = installed_binary
        .parent()
        .ok_or_else(|| {
            err(format!(
                "installed binary has no parent: {}",
                installed_binary.display()
            ))
        })?
        .to_path_buf();

    Ok(SyncCommand {
        program: "docker",
        args: compose_args(resolve_axon_env_file().as_deref(), true),
        env_name: DEV_TARGET_DIR,
        env_value: bin_dir,
    })
}

fn compose_args(env_file: Option<&Path>, include_up: bool) -> Vec<String> {
    let mut args = vec!["compose".to_string()];
    if let Some(env_file) = env_file {
        args.push("--env-file".to_string());
        args.push(env_file.display().to_string());
    }
    args.extend(["-f", "docker-compose.yaml"].into_iter().map(String::from));
    if include_up {
        args.extend(
            ["up", "-d", "axon", "--no-deps", "--no-build"]
                .into_iter()
                .map(String::from),
        );
    }
    args
}

fn resolve_axon_env_file() -> Option<PathBuf> {
    if let Some(path) = env::var_os("AXON_ENV_FILE").map(PathBuf::from)
        && path.is_file()
    {
        return Some(path);
    }
    let axon_home = env::var_os("AXON_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            env::var_os("HOME")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".axon")
        });
    let home_env = axon_home.join(".env");
    if home_env.is_file() {
        return Some(home_env);
    }
    let repo_env = PathBuf::from(".env");
    repo_env.is_file().then_some(repo_env)
}

fn sync_container_from_installed_binary(installed_binary: &Path) -> Result<(), Box<dyn Error>> {
    let sync = build_container_sync_command(installed_binary)?;
    let status = Command::new(sync.program)
        .args(&sync.args)
        .env(sync.env_name, sync.env_value)
        .status()?;
    if !status.success() {
        return Err(err(format!("container sync failed with status {status}")));
    }

    let restart_args = compose_args(resolve_axon_env_file().as_deref(), false);
    let mut restart = Command::new("docker");
    restart.args(&restart_args);
    restart.args(["restart", "axon"]);
    let restart_status = restart.status()?;
    if !restart_status.success() {
        return Err(err(format!(
            "container restart failed with status {restart_status}"
        )));
    }

    Ok(())
}

#[cfg(test)]
#[path = "update_tests.rs"]
mod update_tests;
