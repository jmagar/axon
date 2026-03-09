/// Parse a WebVTT transcript string into clean plain text.
///
/// Strips the WEBVTT header, timestamp lines, position cues, and deduplicates
/// consecutive identical lines that arise from overlapping subtitle windows.
pub fn parse_vtt_to_text(vtt: &str) -> String {
    let mut result: Vec<String> = Vec::new();
    let mut last: Option<String> = None;

    for line in vtt.lines() {
        // Strip the WEBVTT header line
        if line.trim() == "WEBVTT" {
            continue;
        }
        // Strip blank lines
        if line.trim().is_empty() {
            continue;
        }
        // Strip timestamp lines — any line containing "-->"
        if line.contains("-->") {
            continue;
        }
        // Strip numeric-only cue identifiers (VTT sequence numbers like "1", "2", etc.)
        if line.trim().chars().all(|c| c.is_ascii_digit()) && !line.trim().is_empty() {
            continue;
        }

        // Strip HTML tags from content lines
        let mut clean = String::new();
        let mut inside_tag = false;
        for ch in line.chars() {
            match ch {
                '<' => inside_tag = true,
                '>' => inside_tag = false,
                _ if !inside_tag => clean.push(ch),
                _ => {}
            }
        }
        let clean = clean.trim().to_string();

        if clean.is_empty() {
            continue;
        }

        // Deduplicate consecutive identical lines
        if last.as_deref() == Some(&clean) {
            continue;
        }

        last = Some(clean.clone());
        result.push(clean);
    }

    result.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_vtt_strips_header_and_timestamps() {
        let vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello world\n\n00:00:02.000 --> 00:00:04.000\nThis is a test\n";
        let text = parse_vtt_to_text(vtt);
        assert_eq!(text, "Hello world\nThis is a test");
    }

    #[test]
    fn parse_vtt_deduplicates_overlapping_lines() {
        // VTT often repeats the same line as the window shifts
        let vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\nHello world\n\n00:00:01.000 --> 00:00:03.000\nHello world\n\n00:00:03.000 --> 00:00:05.000\nNext sentence\n";
        let text = parse_vtt_to_text(vtt);
        assert_eq!(text, "Hello world\nNext sentence");
    }

    #[test]
    fn parse_vtt_handles_empty_input() {
        assert_eq!(parse_vtt_to_text("WEBVTT\n\n"), "");
    }

    #[test]
    fn parse_vtt_handles_position_cues() {
        // VTT cues with position/alignment metadata
        let vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000 align:start position:0%\nPositioned line\n\n00:00:02.000 --> 00:00:04.000\nNormal line\n";
        let text = parse_vtt_to_text(vtt);
        assert_eq!(text, "Positioned line\nNormal line");
    }

    #[test]
    fn parse_vtt_strips_html_tags() {
        let vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n<c>Tagged</c> text\n";
        let text = parse_vtt_to_text(vtt);
        assert_eq!(text, "Tagged text");
    }

    #[test]
    fn parse_vtt_strips_numeric_cue_ids() {
        let vtt = "WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\nHello world\n\n2\n00:00:02.000 --> 00:00:04.000\nSecond line\n";
        let text = parse_vtt_to_text(vtt);
        assert_eq!(text, "Hello world\nSecond line");
    }

    #[test]
    fn parse_vtt_keeps_lines_with_digits_and_text() {
        // A legitimate line containing digits mixed with text should NOT be stripped
        let vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n3 blind mice\n";
        let text = parse_vtt_to_text(vtt);
        assert_eq!(text, "3 blind mice");
    }
}
