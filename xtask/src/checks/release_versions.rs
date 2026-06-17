use anyhow::{Context, Result, bail};
use semver::Version;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
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
    latest_tag, merge_base, tag_exists,
};

#[cfg(test)]
use files::{
    read_cargo_package_version, read_gradle_version_code, read_gradle_version_name,
    read_json_version,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
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
    json_pointer: Option<String>,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
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
        let parity_errors = check_component_parity(root, component, &plan.version)?;
        errors.extend(
            parity_errors
                .into_iter()
                .map(|error| format!("{}: {error}", component.id)),
        );

        if !plan.changed {
            continue;
        }

        collect_changed_component_errors(root, component, plan, base, head, mode, &mut errors)?;
    }

    print_plans(&plans, json)?;

    if !errors.is_empty() {
        for error in &errors {
            eprintln!("release version error: {error}");
        }
        bail!(
            "release version check failed ({} error(s)): {}",
            errors.len(),
            errors.join("; ")
        );
    }

    Ok(())
}

pub fn plan(
    root: &Path,
    base: Option<&str>,
    head: &str,
    mode: GateMode,
) -> Result<Vec<ComponentPlan>> {
    let manifest = load_manifest(root)?;
    build_plan(root, &manifest, base, head, mode)
}

pub fn print_plans(plans: &[ComponentPlan], json: bool) -> Result<()> {
    if json {
        println!("{}", serde_json::to_string_pretty(plans)?);
    } else {
        for plan in plans {
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
    Ok(())
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
            VersionKind::JsonVersion => {
                replace_json_version(&content, file.json_pointer.as_deref(), &next)?
            }
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
    Version::parse(&version)
        .with_context(|| format!("{} version is not valid semver: {version}", component.id))?;
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
    validate_manifest(&manifest)?;
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
            Version::parse(&version).with_context(|| {
                format!("{} version is not valid semver: {version}", component.id)
            })?;
            let candidate_tag = format!("{}{}", component.tag_prefix, version);
            let last_tag = latest_tag(root, &component.tag_prefix)?;
            let changed = match mode {
                GateMode::Pr => {
                    let base = base.unwrap_or("origin/main");
                    let compare_ref = merge_base(root, base, head)?;
                    component_changed_since_ref(root, component, &compare_ref, head)?
                }
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

fn collect_changed_component_errors(
    root: &Path,
    component: &Component,
    plan: &ComponentPlan,
    base: Option<&str>,
    head: &str,
    mode: GateMode,
    errors: &mut Vec<String>,
) -> Result<()> {
    let candidate = Version::parse(&plan.version).with_context(|| {
        format!(
            "{} version is not valid semver: {}",
            component.id, plan.version
        )
    })?;

    let latest = latest_version_from_plan(component, plan)?;
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
        && let Some(compare_ref) = compare_ref_for_component(root, component, base, head, mode)?
        && let Err(error) = check_gradle_version_code_increased(root, component, &compare_ref)
    {
        errors.push(format!("{}: {error}", component.id));
    }

    Ok(())
}

fn latest_version_from_plan(
    component: &Component,
    plan: &ComponentPlan,
) -> Result<Option<Version>> {
    plan.last_tag
        .as_deref()
        .map(|tag| {
            let version = tag
                .strip_prefix(&component.tag_prefix)
                .with_context(|| format!("{} latest tag has wrong prefix: {tag}", component.id))?;
            Version::parse(version).with_context(|| {
                format!(
                    "{} latest tag has invalid semver suffix: {tag}",
                    component.id
                )
            })
        })
        .transpose()
}

fn validate_manifest(manifest: &Manifest) -> Result<()> {
    let mut component_ids = HashSet::new();
    let mut tag_prefixes: Vec<&str> = Vec::new();

    for component in &manifest.components {
        if component.id.trim().is_empty() {
            bail!("release manifest contains an empty component id");
        }
        if !component_ids.insert(component.id.as_str()) {
            bail!("duplicate release component id {}", component.id);
        }
        if component.tag_prefix.trim().is_empty() {
            bail!("{} has an empty tag_prefix", component.id);
        }
        if tag_prefixes.iter().any(|existing| {
            existing.starts_with(&component.tag_prefix)
                || component.tag_prefix.starts_with(*existing)
        }) {
            bail!("{} tag_prefix overlaps another component", component.id);
        }
        tag_prefixes.push(&component.tag_prefix);
        if component.shipping_paths.is_empty() {
            bail!("{} has no shipping_paths", component.id);
        }
        if !component.release_workflow.ends_with(".yml")
            && !component.release_workflow.ends_with(".yaml")
        {
            bail!("{} release_workflow must be a YAML workflow", component.id);
        }
        validate_version_file(component, "version_source", &component.version_source)?;
        for file in &component.version_files {
            validate_version_file(component, "version_files", file)?;
        }
        if !component
            .version_files
            .iter()
            .any(|file| same_version_file(file, &component.version_source))
        {
            bail!(
                "{} version_source is not listed in version_files",
                component.id
            );
        }
    }

    Ok(())
}

fn validate_version_file(component: &Component, field: &str, file: &VersionFile) -> Result<()> {
    match file.kind {
        VersionKind::CargoPackage => {
            if file.package.as_deref().unwrap_or("").trim().is_empty() {
                bail!(
                    "{} {field} {} cargo_package requires package",
                    component.id,
                    file.path
                );
            }
            if file.json_pointer.is_some() {
                bail!(
                    "{} {field} {} cargo_package must not set json_pointer",
                    component.id,
                    file.path
                );
            }
        }
        VersionKind::JsonVersion => {
            if file.package.is_some() {
                bail!(
                    "{} {field} {} json_version must not set package",
                    component.id,
                    file.path
                );
            }
            let pointer = file.json_pointer.as_deref().unwrap_or("");
            if !pointer.starts_with('/') {
                bail!(
                    "{} {field} {} json_version requires an absolute json_pointer",
                    component.id,
                    file.path
                );
            }
        }
        _ => {
            if file.package.is_some() {
                bail!(
                    "{} {field} {} {:?} must not set package",
                    component.id,
                    file.path,
                    file.kind
                );
            }
            if file.json_pointer.is_some() {
                bail!(
                    "{} {field} {} {:?} must not set json_pointer",
                    component.id,
                    file.path,
                    file.kind
                );
            }
        }
    }
    Ok(())
}

fn same_version_file(left: &VersionFile, right: &VersionFile) -> bool {
    left.kind == right.kind
        && left.path == right.path
        && left.package == right.package
        && left.json_pointer == right.json_pointer
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
