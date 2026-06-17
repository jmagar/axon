use super::*;
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

#[test]
fn reads_component_manifest() {
    let root = repo_root();
    let manifest = load_manifest(&root).expect("manifest loads");
    assert_eq!(manifest.schema_version, 1);
    assert_eq!(manifest.components.len(), 4);
    assert!(
        manifest
            .components
            .iter()
            .any(|component| component.id == "cli")
    );
    assert!(
        manifest
            .components
            .iter()
            .any(|component| component.tag_prefix == "chrome-ext-v")
    );
}

#[test]
fn cargo_package_version_reader_ignores_workspace_version() {
    let content = r#"
[workspace.package]
version = "9.9.9"

[package]
name = "axon"
version = "1.2.3"
"#;
    assert_eq!(
        read_cargo_package_version(content, Some("axon")).expect("version"),
        "1.2.3"
    );
}

#[test]
fn cargo_package_version_bump_handles_version_before_name() {
    let content = r#"
[package]
version = "1.2.3"
name = "axon"
"#;
    let updated =
        replace_cargo_package_version(content, Some("axon"), "1.2.4").expect("replace version");
    assert!(updated.contains(r#"version = "1.2.4""#));
    assert!(updated.contains(r#"name = "axon""#));
}

#[test]
fn json_version_reader_handles_pretty_and_compact_json() {
    assert_eq!(
        read_json_version(r#"{ "name": "axon", "version": "1.2.3" }"#).expect("pretty"),
        "1.2.3"
    );
    assert_eq!(
        read_json_version(r#"{"name":"axon","version":"1.2.4"}"#).expect("compact"),
        "1.2.4"
    );
    assert_eq!(
        read_json_version(r#"{"info":{"version":"1.2.5"}}"#).expect("nested"),
        "1.2.5"
    );
}

#[test]
fn gradle_version_reader_extracts_version_name_and_code() {
    let content = r#"
android {
    defaultConfig {
        versionCode = 42
        versionName = "1.3.2"
    }
}
"#;
    assert_eq!(read_gradle_version_name(content).expect("name"), "1.3.2");
    assert_eq!(read_gradle_version_code(content).expect("code"), 42);
}

#[test]
fn cli_parity_requires_changelog_and_web_versions() {
    let fixture = Fixture::new();
    fs::write(fixture.path("CHANGELOG.md"), "# Changelog\n\n## [0.9.9]\n").unwrap();
    fs::write(
        fixture.path("apps/web/package.json"),
        r#"{"version":"0.9.9"}"#,
    )
    .unwrap();
    let manifest = load_manifest(fixture.root()).unwrap();
    let cli = manifest
        .components
        .iter()
        .find(|component| component.id == "cli")
        .unwrap();
    let errors = check_component_parity(fixture.root(), cli, "1.0.0").unwrap();
    assert!(errors.iter().any(|error| error.contains("CHANGELOG.md")));
    assert!(
        errors
            .iter()
            .any(|error| error.contains("apps/web/package.json"))
    );
}

#[test]
fn plugin_json_version_is_rejected() {
    let fixture = Fixture::new();
    fs::write(
        fixture.path("plugins/axon/.claude-plugin/plugin.json"),
        r#"{"name":"axon","version":"1.0.0"}"#,
    )
    .unwrap();
    let manifest = load_manifest(fixture.root()).unwrap();
    let cli = manifest
        .components
        .iter()
        .find(|component| component.id == "cli")
        .unwrap();
    let errors = check_component_parity(fixture.root(), cli, "1.0.0").unwrap();
    assert!(
        errors
            .iter()
            .any(|error| error.contains("must not contain"))
    );
}

#[test]
fn android_parity_requires_version_code() {
    let fixture = Fixture::new();
    fs::write(
        fixture.path("apps/android/app/build.gradle.kts"),
        r#"android { defaultConfig { versionName = "1.3.2" } }"#,
    )
    .unwrap();
    let manifest = load_manifest(fixture.root()).unwrap();
    let android = manifest
        .components
        .iter()
        .find(|component| component.id == "android")
        .unwrap();
    let errors = check_component_parity(fixture.root(), android, "1.3.2").unwrap();
    assert!(errors.iter().any(|error| error.contains("versionCode")));
}

#[test]
fn cli_parity_rejects_invalid_semver_even_when_versions_match() {
    let fixture = Fixture::new();
    fs::write(
        fixture.path("Cargo.toml"),
        r#"[package]
name = "axon"
version = "banana"
"#,
    )
    .unwrap();
    fs::write(fixture.path("README.md"), "# Axon\n\nVersion: banana\n").unwrap();
    fs::write(fixture.path("CHANGELOG.md"), "# Changelog\n\n## [banana]\n").unwrap();
    fs::write(
        fixture.path("apps/web/package.json"),
        r#"{"version":"banana"}"#,
    )
    .unwrap();
    fs::write(
        fixture.path("apps/web/openapi/axon.json"),
        r#"{"info":{"version":"banana"}}"#,
    )
    .unwrap();

    let error =
        check_cli_parity_only(fixture.root()).expect_err("invalid semver should fail parity");
    assert!(error.to_string().contains("not valid semver"));
}

#[test]
fn semver_tag_sorting_keeps_component_prefixes_separate() {
    let fixture = Fixture::new();
    fixture.init_repo();
    fixture.git(&["tag", "v1.9.0"]);
    fixture.git(&["tag", "v1.10.0"]);
    fixture.git(&["tag", "palette-v9.9.9"]);

    assert_eq!(
        latest_tag(fixture.root(), "v").unwrap(),
        Some("v1.10.0".to_owned())
    );
    assert_eq!(
        latest_tag(fixture.root(), "palette-v").unwrap(),
        Some("palette-v9.9.9".to_owned())
    );
}

#[test]
fn changed_shipping_path_requires_new_tag() {
    let fixture = Fixture::new();
    fixture.init_repo();
    fixture.git(&["tag", "v1.0.0"]);
    fs::write(fixture.path("src/lib.rs"), "pub fn changed() {}\n").unwrap();
    fixture.git(&["add", "src/lib.rs"]);
    fixture.git(&["commit", "-m", "change cli"]);

    let error = check(fixture.root(), Some("v1.0.0"), "HEAD", GateMode::Pr, false)
        .expect_err("unchanged version should fail");
    assert!(error.to_string().contains("release version check failed"));
}

#[test]
fn docs_only_change_does_not_require_component_bump() {
    let fixture = Fixture::new();
    fixture.init_repo();
    fixture.git(&["tag", "v1.0.0"]);
    fs::create_dir_all(fixture.path("docs")).unwrap();
    fs::write(fixture.path("docs/notes.md"), "docs only\n").unwrap();
    fixture.git(&["add", "docs/notes.md"]);
    fixture.git(&["commit", "-m", "docs"]);

    check(fixture.root(), Some("v1.0.0"), "HEAD", GateMode::Pr, false)
        .expect("docs-only change is allowed");
}

#[test]
fn xtask_only_lockfile_change_does_not_require_cli_bump() {
    let fixture = Fixture::new();
    fs::write(
        fixture.path("Cargo.lock"),
        r#"# This file is automatically @generated by Cargo.
version = 4

[[package]]
name = "axon"
version = "1.0.0"

[[package]]
name = "xtask"
version = "0.1.0"
dependencies = [
 "anyhow",
]
"#,
    )
    .unwrap();
    fixture.init_repo();
    fixture.git(&["tag", "v1.0.0"]);
    fs::write(
        fixture.path("Cargo.lock"),
        r#"# This file is automatically @generated by Cargo.
version = 4

[[package]]
name = "axon"
version = "1.0.0"

[[package]]
name = "xtask"
version = "0.1.0"
dependencies = [
 "anyhow",
 "serde",
]
"#,
    )
    .unwrap();
    fixture.git(&["add", "Cargo.lock"]);
    fixture.git(&["commit", "-m", "update xtask lock deps"]);

    let plans = build_plan(
        fixture.root(),
        &load_manifest(fixture.root()).unwrap(),
        Some("v1.0.0"),
        "HEAD",
        GateMode::Pr,
    )
    .unwrap();
    let cli = plans.iter().find(|plan| plan.id == "cli").unwrap();
    assert!(!cli.changed, "xtask-only lockfile changes are tooling-only");
    check(fixture.root(), Some("v1.0.0"), "HEAD", GateMode::Pr, false)
        .expect("xtask-only lockfile change is allowed");
}

#[test]
fn non_xtask_lockfile_change_requires_cli_bump() {
    let fixture = Fixture::new();
    fs::write(
        fixture.path("Cargo.lock"),
        r#"# This file is automatically @generated by Cargo.
version = 4

[[package]]
name = "axon"
version = "1.0.0"
dependencies = [
 "anyhow",
]

[[package]]
name = "xtask"
version = "0.1.0"
"#,
    )
    .unwrap();
    fixture.init_repo();
    fixture.git(&["tag", "v1.0.0"]);
    fs::write(
        fixture.path("Cargo.lock"),
        r#"# This file is automatically @generated by Cargo.
version = 4

[[package]]
name = "axon"
version = "1.0.0"
dependencies = [
 "anyhow",
 "serde",
]

[[package]]
name = "xtask"
version = "0.1.0"
"#,
    )
    .unwrap();
    fixture.git(&["add", "Cargo.lock"]);
    fixture.git(&["commit", "-m", "update app lock deps"]);

    let plans = build_plan(
        fixture.root(),
        &load_manifest(fixture.root()).unwrap(),
        Some("v1.0.0"),
        "HEAD",
        GateMode::Pr,
    )
    .unwrap();
    let cli = plans.iter().find(|plan| plan.id == "cli").unwrap();
    assert!(cli.changed, "app lockfile changes are release-relevant");
    let error = check(fixture.root(), Some("v1.0.0"), "HEAD", GateMode::Pr, false)
        .expect_err("app lockfile change requires CLI bump");
    assert!(error.to_string().contains("release version check failed"));
}

#[test]
fn android_change_requires_version_code_increase() {
    let fixture = Fixture::new();
    fixture.init_repo();
    fixture.git(&["tag", "android-v1.3.2"]);
    fs::write(
        fixture.path("apps/android/app/build.gradle.kts"),
        r#"android {
    defaultConfig {
        versionCode = 6
        versionName = "1.3.3"
    }
}
"#,
    )
    .unwrap();
    fixture.git(&["add", "apps/android/app/build.gradle.kts"]);
    fixture.git(&["commit", "-m", "bump android version name"]);

    let error = check(
        fixture.root(),
        Some("android-v1.3.2"),
        "HEAD",
        GateMode::Pr,
        false,
    )
    .expect_err("android versionCode must increase");
    assert!(format!("{error:?}").contains("versionCode must increase"));
}

#[test]
fn android_change_allows_version_code_increase() {
    let fixture = Fixture::new();
    fixture.init_repo();
    fixture.git(&["tag", "android-v1.3.2"]);
    fs::write(
        fixture.path("apps/android/app/build.gradle.kts"),
        r#"android {
    defaultConfig {
        versionCode = 7
        versionName = "1.3.3"
    }
}
"#,
    )
    .unwrap();
    fixture.git(&["add", "apps/android/app/build.gradle.kts"]);
    fixture.git(&["commit", "-m", "bump android version"]);

    check(
        fixture.root(),
        Some("android-v1.3.2"),
        "HEAD",
        GateMode::Pr,
        false,
    )
    .expect("android versionName and versionCode bump is accepted");
}

#[test]
fn chrome_assets_change_requires_chrome_bump() {
    let fixture = Fixture::new();
    fixture.init_repo();
    fixture.git(&["tag", "chrome-ext-v0.2.0"]);
    fs::write(fixture.path("assets/icon.svg"), "<svg />\n").unwrap();
    fixture.git(&["add", "assets/icon.svg"]);
    fixture.git(&["commit", "-m", "change asset"]);

    let error = check(
        fixture.root(),
        Some("chrome-ext-v0.2.0"),
        "HEAD",
        GateMode::Pr,
        false,
    )
    .expect_err("chrome asset change requires bump");
    assert!(error.to_string().contains("release version check failed"));
}

struct Fixture {
    temp: TempDir,
}

impl Fixture {
    fn new() -> Self {
        let temp = TempDir::new().expect("tempdir");
        let fixture = Self { temp };
        fixture.write_minimal_tree();
        fixture
    }

    fn root(&self) -> &Path {
        self.temp.path()
    }

    fn path(&self, path: &str) -> PathBuf {
        self.root().join(path)
    }

    fn init_repo(&self) {
        self.git(&["init"]);
        self.git(&["config", "user.email", "test@example.com"]);
        self.git(&["config", "user.name", "Test User"]);
        self.git(&["add", "."]);
        self.git(&["commit", "-m", "initial"]);
    }

    fn git(&self, args: &[&str]) {
        git(self.root(), args);
    }

    fn write_minimal_tree(&self) {
        write(
            &self.path("release/components.toml"),
            include_str!("../../../release/components.toml"),
        );
        write(
            &self.path("Cargo.toml"),
            r#"[package]
name = "axon"
version = "1.0.0"
"#,
        );
        write(&self.path("README.md"), "# Axon\n\nVersion: 1.0.0\n");
        write(&self.path("CHANGELOG.md"), "# Changelog\n\n## [1.0.0]\n");
        write(
            &self.path("apps/web/package.json"),
            r#"{"version":"1.0.0"}"#,
        );
        write(
            &self.path("apps/web/openapi/axon.json"),
            r#"{"info":{"version":"1.0.0"}}"#,
        );
        write(
            &self.path("plugins/axon/.claude-plugin/plugin.json"),
            r#"{"name":"axon"}"#,
        );
        write(&self.path("src/lib.rs"), "pub fn original() {}\n");
        write(&self.path("Cargo.lock"), "");
        write(&self.path("build.rs"), "");
        write(&self.path("migrations/.keep"), "");
        write(&self.path("rust-toolchain.toml"), "");
        write(&self.path("vendor/.keep"), "");
        write(
            &self.path("apps/palette-tauri/src-tauri/tauri.conf.json"),
            r#"{"version":"5.10.2"}"#,
        );
        write(
            &self.path("apps/palette-tauri/package.json"),
            r#"{"version":"5.10.2"}"#,
        );
        write(
            &self.path("apps/palette-tauri/src-tauri/Cargo.toml"),
            r#"[package]
name = "axon-palette-tauri"
version = "5.10.2"
"#,
        );
        write(
            &self.path("apps/android/app/build.gradle.kts"),
            r#"android {
    defaultConfig {
        versionCode = 6
        versionName = "1.3.2"
    }
}
"#,
        );
        write(
            &self.path("apps/chrome-extension/manifest.json"),
            r#"{"manifest_version":3,"version":"0.2.0"}"#,
        );
        write(&self.path("assets/.keep"), "");
    }
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("xtask parent")
        .to_path_buf()
}

fn write(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, content).unwrap();
}

fn git(root: &Path, args: &[&str]) {
    let status = std::process::Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .status()
        .expect("git runs");
    assert!(status.success(), "git {:?} failed", args);
}
