use super::{Component, VersionFile, VersionKind};
use anyhow::{Context, Result, bail};
use regex::Regex;
use std::path::Path;
use std::process::Command;

pub(super) fn read_version(root: &Path, file: &VersionFile) -> Result<String> {
    let path = root.join(&file.path);
    let content =
        std::fs::read_to_string(&path).with_context(|| format!("failed to read {}", file.path))?;
    match file.kind {
        VersionKind::CargoPackage => read_cargo_package_version(&content, file.package.as_deref())
            .with_context(|| format!("failed to read Cargo package version from {}", file.path)),
        VersionKind::JsonVersion => read_json_version(&content, file.json_pointer.as_deref())
            .with_context(|| format!("failed to read JSON version from {}", file.path)),
        VersionKind::GradleVersionName => read_gradle_version_name(&content)
            .with_context(|| format!("failed to read versionName from {}", file.path)),
        VersionKind::ReadmeVersionLine
        | VersionKind::ChangelogHeading
        | VersionKind::JsonNoVersion
        | VersionKind::GradleVersionCode => {
            bail!("{:?} is not a canonical version source", file.kind)
        }
    }
}

pub(super) fn check_component_parity(
    root: &Path,
    component: &Component,
    expected: &str,
) -> Result<Vec<String>> {
    let mut errors = Vec::new();
    for file in &component.version_files {
        let content = match std::fs::read_to_string(root.join(&file.path)) {
            Ok(content) => content,
            Err(error) => {
                errors.push(format!("{}: failed to read: {error}", file.path));
                continue;
            }
        };
        let result = match file.kind {
            VersionKind::CargoPackage => {
                check_cargo_package_version(&content, file.package.as_deref(), expected)
            }
            VersionKind::ReadmeVersionLine => check_readme_version_line(&content, expected),
            VersionKind::ChangelogHeading => check_changelog_heading(&content, expected),
            VersionKind::JsonVersion => {
                check_json_version(&content, file.json_pointer.as_deref(), expected)
            }
            VersionKind::JsonNoVersion => check_json_no_version(&content),
            VersionKind::GradleVersionName => check_gradle_version_name(&content, expected),
            VersionKind::GradleVersionCode => check_gradle_version_code_present(&content),
        };
        if let Err(error) = result {
            errors.push(format!("{}: {error}", file.path));
        }
    }
    Ok(errors)
}

pub(super) fn read_cargo_package_version(content: &str, package: Option<&str>) -> Result<String> {
    let value: toml::Value = toml::from_str(content).context("invalid TOML")?;
    let package_table = value
        .get("package")
        .and_then(|value| value.as_table())
        .context("missing [package] table")?;
    if let Some(expected_name) = package {
        let name = package_table
            .get("name")
            .and_then(|value| value.as_str())
            .context("missing package.name")?;
        if name != expected_name {
            bail!("expected package {expected_name}, found {name}");
        }
    }
    package_table
        .get("version")
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
        .context("missing package.version")
}

pub(super) fn read_json_version(content: &str, pointer: Option<&str>) -> Result<String> {
    let value: serde_json::Value = serde_json::from_str(content).context("invalid JSON")?;
    let pointer = pointer.unwrap_or("/version");
    value
        .pointer(pointer)
        .and_then(|value| value.as_str())
        .map(ToOwned::to_owned)
        .with_context(|| format!("missing JSON version field at {pointer}"))
}

pub(super) fn read_gradle_version_name(content: &str) -> Result<String> {
    let regex = Regex::new(r#"(?m)^\s*versionName\s*=\s*"([^"]+)""#)?;
    regex
        .captures(content)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str().to_owned())
        .context("missing versionName")
}

pub(super) fn read_gradle_version_code(content: &str) -> Result<u64> {
    let regex = Regex::new(r#"(?m)^\s*versionCode\s*=\s*(\d+)"#)?;
    regex
        .captures(content)
        .and_then(|captures| captures.get(1))
        .context("missing versionCode")?
        .as_str()
        .parse()
        .context("versionCode is not an integer")
}

fn check_cargo_package_version(content: &str, package: Option<&str>, expected: &str) -> Result<()> {
    let actual = read_cargo_package_version(content, package)?;
    if actual != expected {
        bail!("expected package version {expected}, found {actual}");
    }
    Ok(())
}

fn check_readme_version_line(content: &str, expected: &str) -> Result<()> {
    let expected = format!("Version: {expected}");
    if !content.lines().any(|line| line.trim() == expected) {
        bail!("missing '{expected}'");
    }
    Ok(())
}

fn check_changelog_heading(content: &str, expected: &str) -> Result<()> {
    let expected = format!("## [{expected}]");
    if !content.lines().any(|line| line.starts_with(&expected)) {
        bail!("missing '{expected}' heading");
    }
    Ok(())
}

fn check_json_version(content: &str, pointer: Option<&str>, expected: &str) -> Result<()> {
    let actual = read_json_version(content, pointer)?;
    if actual != expected {
        bail!("expected JSON version {expected}, found {actual}");
    }
    Ok(())
}

fn check_json_no_version(content: &str) -> Result<()> {
    let value: serde_json::Value = serde_json::from_str(content).context("invalid JSON")?;
    if contains_json_version_key(&value) {
        bail!("must not contain a version key");
    }
    Ok(())
}

fn contains_json_version_key(value: &serde_json::Value) -> bool {
    match value {
        serde_json::Value::Object(map) => {
            map.contains_key("version") || map.values().any(contains_json_version_key)
        }
        serde_json::Value::Array(values) => values.iter().any(contains_json_version_key),
        _ => false,
    }
}

fn check_gradle_version_name(content: &str, expected: &str) -> Result<()> {
    let actual = read_gradle_version_name(content)?;
    if actual != expected {
        bail!("expected versionName {expected}, found {actual}");
    }
    Ok(())
}

fn check_gradle_version_code_present(content: &str) -> Result<()> {
    read_gradle_version_code(content)?;
    Ok(())
}

pub(super) fn replace_json_version(
    content: &str,
    pointer: Option<&str>,
    next: &str,
) -> Result<String> {
    let pointer = pointer.unwrap_or("/version");
    let mut value: serde_json::Value = serde_json::from_str(content).context("invalid JSON")?;
    let target = value
        .pointer_mut(pointer)
        .with_context(|| format!("missing JSON version field at {pointer}"))?;
    if !target.is_string() {
        bail!("JSON version field at {pointer} is not a string");
    }
    *target = serde_json::Value::String(next.to_owned());
    serde_json::to_string_pretty(&value).context("failed to serialize JSON")
}

pub(super) fn replace_cargo_package_version(
    content: &str,
    package: Option<&str>,
    next: &str,
) -> Result<String> {
    read_cargo_package_version(content, package)?;
    let mut in_package = false;
    let mut replaced = false;
    let mut output = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "[package]" {
            in_package = true;
        } else if in_package && trimmed.starts_with('[') {
            in_package = false;
        }

        let mut next_line = line.to_owned();
        if in_package
            && trimmed.starts_with("version")
            && extract_toml_string_assignment(trimmed).is_some()
        {
            let leading = &line[..line.len() - line.trim_start().len()];
            next_line = format!(r#"{leading}version = "{next}""#);
            replaced = true;
        }
        output.push(next_line);
    }
    if !replaced {
        bail!("missing Cargo package version");
    }
    Ok(preserve_trailing_newline(content, output.join("\n")))
}

fn extract_toml_string_assignment(line: &str) -> Option<&str> {
    let (_, value) = line.split_once('=')?;
    value.trim().strip_prefix('"')?.strip_suffix('"')
}

pub(super) fn replace_gradle_version_name(content: &str, next: &str) -> Result<String> {
    let regex = Regex::new(r#"(?m)^(\s*versionName\s*=\s*)"[^"]+""#)?;
    if !regex.is_match(content) {
        bail!("missing versionName");
    }
    Ok(regex.replace(content, format!(r#"$1"{next}""#)).to_string())
}

pub(super) fn increment_gradle_version_code(content: &str) -> Result<String> {
    let regex = Regex::new(r#"(?m)^(\s*versionCode\s*=\s*)(\d+)"#)?;
    let captures = regex.captures(content).context("missing versionCode")?;
    let current: u64 = captures[2]
        .parse()
        .context("versionCode is not an integer")?;
    Ok(regex
        .replace(content, format!("${{1}}{}", current + 1))
        .to_string())
}

pub(super) fn replace_readme_version_line(content: &str, next: &str) -> Result<String> {
    let regex = Regex::new(r#"(?m)^Version:\s*[0-9A-Za-z.+-]+$"#)?;
    if !regex.is_match(content) {
        bail!("missing README Version line");
    }
    Ok(regex
        .replace(content, format!("Version: {next}"))
        .to_string())
}

pub(super) fn ensure_changelog_heading(content: &str, next: &str) -> String {
    let heading = format!("## [{next}]");
    if content.lines().any(|line| line.starts_with(&heading)) {
        return content.to_owned();
    }
    let date = release_date();
    let block = format!("## [{next}] - {date}\n\n### Changed\n- Release version bump.\n\n");
    let mut lines = content.lines();
    let Some(first) = lines.next() else {
        return format!("# Changelog\n\n{block}");
    };
    if first.starts_with("# ") {
        let rest = lines.collect::<Vec<_>>().join("\n");
        if rest.trim().is_empty() {
            format!("{first}\n\n{block}")
        } else {
            preserve_trailing_newline(content, format!("{first}\n\n{block}{}", rest.trim_start()))
        }
    } else {
        format!("{block}{content}")
    }
}

fn release_date() -> String {
    Command::new("date")
        .arg("+%F")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .filter(|date| !date.is_empty())
        .unwrap_or_else(|| "1970-01-01".to_owned())
}

fn preserve_trailing_newline(original: &str, mut updated: String) -> String {
    if original.ends_with('\n') && !updated.ends_with('\n') {
        updated.push('\n');
    }
    updated
}
