use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const FALLBACK_MARKER: &str = "AXON_FALLBACK_WEB_PANEL";

fn main() {
    println!("cargo:rerun-if-changed=apps/web/out");
    println!("cargo:rerun-if-env-changed=AXON_ALLOW_FALLBACK_WEB_ASSETS");

    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR set"));
    let source = manifest_dir.join("apps/web/out");

    match asset_state(&source) {
        Ok(AssetState::Ready) => {}
        Ok(AssetState::Missing | AssetState::Empty | AssetState::FallbackOnly)
            if allow_fallback_assets() =>
        {
            println!("cargo:warning=apps/web/out is empty; embedding fallback web panel");
            fs::create_dir_all(&source).expect("create web assets fallback dir");
            write_fallback_index(&source).expect("write fallback web index");
        }
        Ok(AssetState::Missing | AssetState::Empty) => {
            panic!("apps/web/out is empty; run the web build before compiling axon")
        }
        Ok(AssetState::FallbackOnly) => {
            panic!(
                "apps/web/out contains only fallback assets; run the web build before compiling axon"
            )
        }
        Err(error) if allow_fallback_assets() => {
            println!(
                "cargo:warning=apps/web/out is unreadable: {error}; embedding fallback web panel"
            );
            fs::create_dir_all(&source).expect("create web assets fallback dir");
            write_fallback_index(&source).expect("write fallback web index");
        }
        Err(error) => panic!("apps/web/out is unreadable: {error}"),
    }
}

fn allow_fallback_assets() -> bool {
    env::var_os("AXON_ALLOW_FALLBACK_WEB_ASSETS").is_some()
}

enum AssetState {
    Missing,
    Empty,
    FallbackOnly,
    Ready,
}

fn asset_state(path: &Path) -> io::Result<AssetState> {
    if !path.is_dir() {
        return Ok(AssetState::Missing);
    }

    let entries = fs::read_dir(path)?.collect::<Result<Vec<_>, _>>()?;
    if entries.is_empty() {
        return Ok(AssetState::Empty);
    }

    if entries.len() == 1 && entries[0].file_name() == "index.html" {
        let index = fs::read_to_string(entries[0].path())?;
        if index.contains(FALLBACK_MARKER) {
            return Ok(AssetState::FallbackOnly);
        }
    }

    Ok(AssetState::Ready)
}

fn write_fallback_index(destination: &Path) -> io::Result<()> {
    fs::write(
        destination.join("index.html"),
        r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="axon-build" content="AXON_FALLBACK_WEB_PANEL" />
    <title>Axon</title>
  </head>
  <body>
    <main>
      <h1>Axon web panel is not built</h1>
      <p>Run <code>npm --prefix apps/web run build</code> to embed the full web panel.</p>
    </main>
  </body>
</html>
"#,
    )
}
