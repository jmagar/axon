use anyhow::{Context, Result, bail};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::path::Path;

mod files;
mod git;

use files::{
    check_component_parity, ensure_changelog_heading, increment_gradle_version_code, read_version,
    replace_cargo_package_version, replace_gradle_version_name, replace_json_version,
    replace_readme_version_line,
};
use git::{
    check_gradle_version_code_increased, compare_ref_for_component, component_changed_since_ref,
    latest_tag, latest_version, tag_exists,
};

#[cfg(test)]
use files::{
    read_cargo_package_version, read_gradle_version_code, read_gradle_version_name,
    read_json_version,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GateMode {
    Pr,
    Main,
}

#[derive(Debug, Clone, Serialize)]
pub struct ComponentPlan {
    pub id: String,
    pub name: String,
    pub changed: bool,
    pub version: String,
    pub candidate_tag: String,
    pub last_tag: Option<String>,
    pub release_workflow: String,
    pub shipping_paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct Manifest {
    schema_version: u32,
    components: Vec<Component>,
}

#[derive(Debug, Deserialize)]
struct Component {
    id: String,
    name: String,
    tag_prefix: String,
    release_workflow: String,
    shipping_paths: Vec<String>,
    version_source: VersionFile,
    version_files: Vec<VersionFile>,
}

#[derive(Debug, Deserialize, Clone)]
struct VersionFile {
    kind: VersionKind,
    path: String,
    package: Option<String>,
}

#[derive(Debug, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum VersionKind {
    CargoPackage,
    ReadmeVersionLine,
    ChangelogHeading,
    JsonVersion,
    JsonNoVersion,
    GradleVersionName,
    GradleVersionCode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BumpLevel {
    Patch,
    Minor,
    Major,
}

pub fn check(
    root: &Path,
    base: Option<&str>,
    head: &str,
    mode: GateMode,
    json: bool,
) -> Result<()> {
    let manifest = load_manifest(root)?;
    let plans = build_plan(root, &manifest, base, head, mode)?;
    let mut errors = Vec::new();

    for (component, plan) in manifest.components.iter().zip(plans.iter()) {
        let expected = &plan.version;
        let parity_errors = check_component_parity(root, component, expected)?;
        errors.extend(
            parity_errors
                .into_iter()
                .map(|error| format!("{}: {error}", component.id)),
        );

        if !plan.changed {
            continue;
        }

        let latest = latest_version(root, &component.tag_prefix)?;
        let candidate = Version::parse(&plan.version).with_context(|| {
            format!(
                "{} version is not valid semver: {}",
                component.id, plan.version
            )
        })?;
        if let Some(latest) = latest
            && candidate <= latest
        {
            errors.push(format!(
                "{} code changed but version {} is not greater than latest {} tag version {}. Bump {} before merging.",
                component.id,
                plan.version,
                component.tag_prefix,
                latest,
                bump_hint(component)
            ));
        }

        if tag_exists(root, &plan.candidate_tag)? {
            errors.push(format!(
                "{} code changed but tag {} already exists. Bump {} before merging.",
                component.id,
                plan.candidate_tag,
                bump_hint(component)
            ));
        }

        if component_has_kind(component, VersionKind::GradleVersionCode)
            && let Some(compare_ref) = compare_ref_for_component(root, component, base, mode)?
            && let Err(error) = check_gradle_version_code_increased(root, component, &compare_ref)
        {
            errors.push(format!("{}: {error}", component.id));
        }
    }

    if json {
        println!("{}", serde_json::to_string_pretty(&plans)?);
    } else {
        for plan in &plans {
            println!(
                "{} changed={} version={} tag={} last_tag={} workflow={}",
                plan.id,
                plan.changed,
                plan.version,
                plan.candidate_tag,
                plan.last_tag.as_deref().unwrap_or("-"),
                plan.release_workflow
            );
        }
    }

    if !errors.is_empty() {
        for error in &errors {
            eprintln!("release version error: {error}");
        }
        bail!("release version check failed ({} error(s))", errors.len());
    }

    Ok(())
}

pub fn plan(root: &Path, base: Option<&str>, head: &str) -> Result<Vec<ComponentPlan>> {
    let manifest = load_manifest(root)?;
    build_plan(root, &manifest, base, head, GateMode::Pr)
}

pub fn bump(root: &Path, component_id: &str, level: BumpLevel) -> Result<()> {
    let manifest = load_manifest(root)?;
    let component = manifest
        .components
        .iter()
        .find(|component| component.id == component_id)
        .with_context(|| format!("unknown release component {component_id}"))?;
    let current = read_version(root, &component.version_source)?;
    let current = Version::parse(&current)
        .with_context(|| format!("{} version is not valid semver: {current}", component.id))?;
    let next = match level {
        BumpLevel::Patch => Version::new(current.major, current.minor, current.patch + 1),
        BumpLevel::Minor => Version::new(current.major, current.minor + 1, 0),
        BumpLevel::Major => Version::new(current.major + 1, 0, 0),
    };
    let next = next.to_string();

    for file in &component.version_files {
        let path = root.join(&file.path);
        let content = std::fs::read_to_string(&path)
            .with_context(|| format!("failed to read {}", file.path))?;
        let updated = match file.kind {
            VersionKind::CargoPackage => {
                replace_cargo_package_version(&content, file.package.as_deref(), &next)?
            }
            VersionKind::ReadmeVersionLine => replace_readme_version_line(&content, &next)?,
            VersionKind::ChangelogHeading => ensure_changelog_heading(&content, &next),
            VersionKind::JsonVersion => replace_json_version(&content, &next)?,
            VersionKind::JsonNoVersion => content.clone(),
            VersionKind::GradleVersionName => replace_gradle_version_name(&content, &next)?,
            VersionKind::GradleVersionCode => increment_gradle_version_code(&content)?,
        };
        if updated != content {
            std::fs::write(&path, updated)
                .with_context(|| format!("failed to write {}", file.path))?;
        }
    }

    Ok(())
}

pub fn check_cli_parity_only(root: &Path) -> Result<()> {
    let manifest = load_manifest(root)?;
    let component = manifest
        .components
        .iter()
        .find(|component| component.id == "cli")
        .context("release manifest is missing cli component")?;
    let version = read_version(root, &component.version_source)?;
    let errors = check_component_parity(root, component, &version)?;
    if !errors.is_empty() {
        for error in &errors {
            eprintln!("version sync error: cli: {error}");
        }
        bail!("version sync check failed ({} error(s))", errors.len());
    }
    println!("OK: all CLI version-bearing files are in sync at {version}.");
    Ok(())
}

fn load_manifest(root: &Path) -> Result<Manifest> {
    let path = root.join("release/components.toml");
    let content =
        std::fs::read_to_string(&path).context("failed to read release/components.toml")?;
    let manifest: Manifest =
        toml::from_str(&content).context("failed to parse release/components.toml")?;
    if manifest.schema_version != 1 {
        bail!(
            "unsupported release/components.toml schema_version {}",
            manifest.schema_version
        );
    }
    Ok(manifest)
}

fn build_plan(
    root: &Path,
    manifest: &Manifest,
    base: Option<&str>,
    head: &str,
    mode: GateMode,
) -> Result<Vec<ComponentPlan>> {
    manifest
        .components
        .iter()
        .map(|component| {
            let version = read_version(root, &component.version_source)?;
            let candidate_tag = format!("{}{}", component.tag_prefix, version);
            let last_tag = latest_tag(root, &component.tag_prefix)?;
            let changed = match mode {
                GateMode::Pr => component_changed_since_ref(
                    root,
                    component,
                    base.unwrap_or("origin/main"),
                    head,
                )?,
                GateMode::Main => match last_tag.as_deref() {
                    Some(tag) => component_changed_since_ref(root, component, tag, head)?,
                    None => true,
                },
            };
            Ok(ComponentPlan {
                id: component.id.clone(),
                name: component.name.clone(),
                changed,
                version,
                candidate_tag,
                last_tag,
                release_workflow: component.release_workflow.clone(),
                shipping_paths: component.shipping_paths.clone(),
            })
        })
        .collect()
}

fn bump_hint(component: &Component) -> String {
    match component.id.as_str() {
        "android" => "apps/android/app/build.gradle.kts versionName and versionCode".to_owned(),
        "chrome" => "apps/chrome-extension/manifest.json".to_owned(),
        _ => format!("the {} version files", component.id),
    }
}

fn component_has_kind(component: &Component, kind: VersionKind) -> bool {
    component.version_files.iter().any(|file| file.kind == kind)
}

#[cfg(test)]
#[path = "release_versions_tests.rs"]
mod tests;
