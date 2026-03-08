//! ZIP archive creation for download routes.

use std::io::Write;

/// Build a ZIP archive from entries. Runs in a blocking context.
pub(crate) fn build_zip(
    _domain: &str,
    entries: &[(String, String, String)],
) -> Result<Vec<u8>, Box<dyn std::error::Error + Send + Sync>> {
    let buf = Vec::with_capacity(entries.iter().map(|(_, _, c)| c.len()).sum::<usize>());
    let cursor = std::io::Cursor::new(buf);
    let mut zip = zip::ZipWriter::new(cursor);

    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    for (_, rel_path, content) in entries {
        zip.start_file(rel_path, options)?;
        zip.write_all(content.as_bytes())?;
    }

    let cursor = zip.finish()?;
    Ok(cursor.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zip_roundtrip() {
        let entries = vec![
            (
                "https://example.com/a".to_string(),
                "markdown/a.md".to_string(),
                "Hello from A".to_string(),
            ),
            (
                "https://example.com/b".to_string(),
                "markdown/b.md".to_string(),
                "Hello from B".to_string(),
            ),
        ];
        let bytes = build_zip("example.com", &entries).expect("zip should build");
        assert!(!bytes.is_empty());
        // Verify it's a valid ZIP by checking magic bytes
        assert_eq!(&bytes[0..2], b"PK");
    }

    // ── zip-slip defence ───────────────────────────────────────────────────

    #[test]
    fn zip_slip_dotdot_entry_name() {
        // `build_zip` passes the caller-supplied rel_path directly to the zip writer.
        // This test documents the current behaviour: the zip crate v8 stores the name
        // verbatim and does NOT normalise `../` components. Any zip-slip defence must
        // therefore be enforced by the caller before invoking `build_zip`.
        let entries = vec![(
            "https://example.com".to_string(),
            "../../../etc/passwd".to_string(),
            "evil".to_string(),
        )];
        let bytes = build_zip("example.com", &entries).expect("zip should build");
        assert_eq!(&bytes[0..2], b"PK", "result must still be a valid ZIP");

        // Read back the archive and inspect all entry names.
        let cursor = std::io::Cursor::new(bytes);
        let mut archive = zip::ZipArchive::new(cursor).expect("should parse as ZIP");
        let entry_names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();

        // Document: the zip crate stores the path verbatim — it contains `..`.
        // A consumer that naively extracts to a directory is vulnerable to zip-slip.
        // Callers MUST sanitise rel_path before passing it to build_zip.
        let has_traversal = entry_names
            .iter()
            .any(|n| n.starts_with("..") || n.contains("../"));
        assert!(
            has_traversal,
            "zip crate v8 stores '../' verbatim — caller must sanitise: {entry_names:?}"
        );
    }

    #[test]
    fn zip_empty_entries() {
        let bytes = build_zip("example.com", &[]).expect("empty zip should build");
        assert!(
            !bytes.is_empty(),
            "even an empty ZIP has end-of-central-directory bytes"
        );
        assert_eq!(&bytes[0..2], b"PK", "magic bytes must be PK");
    }

    #[test]
    fn zip_subdirectory_entry() {
        let entries = vec![(
            "https://example.com/page".to_string(),
            "subdir/file.md".to_string(),
            "# Page content".to_string(),
        )];
        let bytes = build_zip("example.com", &entries).expect("zip should build");
        let cursor = std::io::Cursor::new(bytes);
        let mut archive = zip::ZipArchive::new(cursor).expect("should parse as ZIP");
        assert_eq!(archive.len(), 1, "expected exactly one entry");
        let entry = archive.by_index(0).expect("entry 0 should exist");
        assert_eq!(
            entry.name(),
            "subdir/file.md",
            "entry name must be stored exactly as supplied"
        );
    }
}
