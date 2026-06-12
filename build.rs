use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

fn main() {
    println!("cargo:rerun-if-changed=apps/web/out");

    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR set"));
    let source = manifest_dir.join("apps/web/out");
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR set")).join("web-assets");

    if out_dir.exists() {
        fs::remove_dir_all(&out_dir).expect("remove stale generated web assets");
    }
    fs::create_dir_all(&out_dir).expect("create generated web assets dir");

    if source.is_dir() {
        copy_dir(&source, &out_dir).expect("copy apps/web/out into generated web assets");
    } else {
        write_fallback_index(&out_dir).expect("write fallback web index");
    }
}

fn copy_dir(source: &Path, destination: &Path) -> io::Result<()> {
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            fs::create_dir_all(&destination_path)?;
            copy_dir(&source_path, &destination_path)?;
        } else {
            fs::copy(source_path, destination_path)?;
        }
    }
    Ok(())
}

fn write_fallback_index(destination: &Path) -> io::Result<()> {
    fs::write(
        destination.join("index.html"),
        r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
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
