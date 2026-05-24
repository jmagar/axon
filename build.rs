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
    let path = std::path::Path::new("apps/web/out");
    if !path.exists() {
        let _ = std::fs::create_dir_all(path);
    }
    println!("cargo:rerun-if-changed=apps/web/out");
}
