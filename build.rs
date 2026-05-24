// Ensure the `apps/web/out/` directory exists at compile time.
//
// `src/web/static_assets.rs` uses `#[derive(RustEmbed)] #[folder = "apps/web/out/"]`
// which fails the build if the directory is missing. The Next.js frontend
// (apps/web) is built and exported into `apps/web/out/` for production
// release builds, but for a Rust-only workflow — fresh clone, CI, or `cargo
// test` — the directory may not exist. Creating an empty placeholder keeps
// the embed empty (which is what `static_assets.rs` already handles) without
// requiring every entry point (CI, lefthook, dev shell) to do it manually.
fn main() {
    // Emitting any `cargo:rerun-if-changed` directive switches Cargo
    // from "watch all package files" to "watch ONLY listed paths" for
    // this build script. Re-list build.rs explicitly so edits to this
    // file still trigger a rebuild.
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=apps/web/out");

    let path = std::path::Path::new("apps/web/out");
    if !path.exists() {
        if let Err(e) = std::fs::create_dir_all(path) {
            // Print to stderr so the failure shows up in the build log
            // with a clear pointer at the real cause instead of the
            // downstream `#[derive(RustEmbed)]` opaque error.
            eprintln!("build.rs: failed to create {}: {e}", path.display());
            std::process::exit(1);
        }
    }
}
