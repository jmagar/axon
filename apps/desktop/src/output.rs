use std::process::ExitStatus;

use gpui::SharedString;

mod formatting;
mod process;

#[cfg(test)]
#[path = "output_tests.rs"]
mod tests;

use formatting::{
    actionable_error_text, command_title, format_exit_status, palette_output_text, strip_ansi,
    truncate_output,
};
#[cfg(test)]
use formatting::{
    ask_answer, crawl_summary, drop_cli_scaffolding, map_url_listing, scrape_body,
};
pub(crate) use process::run_command_bounded;
#[cfg(test)]
use process::BoundedByteBuffer;

use crate::actions::CommandAction;
use crate::markdown::MarkdownDocument;
use crate::theme::{
    AURORA_ACCENT_PINK, AURORA_ACCENT_PRIMARY, AURORA_ACCENT_STRONG, AURORA_WARNING,
};

const OUTPUT_LIMIT: usize = 12_000;
const TRUNCATED_MESSAGE: &str = "\n... output truncated ...";
/// Maximum number of lines rendered for a raw (non-markdown) output
/// section. Mirrors the `take(MAX_RENDER_LINES)` cap in `render.rs`.
pub(crate) const MAX_RENDER_LINES: usize = 220;

#[derive(Clone)]
pub(crate) struct CommandOutput {
    pub(crate) kind: OutputKind,
    pub(crate) title: String,
    pub(crate) subtitle: String,
    pub(crate) stdout: Option<OutputSection>,
    pub(crate) stderr: Option<OutputSection>,
    pub(crate) use_markdown: bool,
    pub(crate) compact_stdout: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum OutputKind {
    Running,
    Success,
    Warning,
    Error,
}

#[derive(Clone)]
pub(crate) struct OutputSection {
    pub(crate) label: &'static str,
    pub(crate) text: String,
    pub(crate) line_count: usize,
    /// Pre-computed visible raw lines, capped at `MAX_RENDER_LINES`, so render
    /// frames can clone cheap `SharedString`s instead of reallocating lines.
    pub(crate) rendered_lines: Vec<SharedString>,
    pub(crate) markdown: Option<MarkdownDocument>,
}

pub(crate) struct BoundedProcessOutput {
    pub(crate) status: ExitStatus,
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: Vec<u8>,
}

impl CommandOutput {
    pub(crate) fn running(command_line: &str, action: CommandAction) -> Self {
        Self {
            kind: OutputKind::Running,
            title: format!("Running {}", action.label),
            subtitle: command_line.to_string(),
            stdout: None,
            stderr: None,
            use_markdown: false,
            compact_stdout: false,
        }
    }

    pub(crate) fn notice(
        kind: OutputKind,
        title: impl Into<String>,
        subtitle: impl Into<String>,
    ) -> Self {
        Self {
            kind,
            title: title.into(),
            subtitle: subtitle.into(),
            stdout: None,
            stderr: None,
            use_markdown: false,
            compact_stdout: false,
        }
    }

    pub(crate) fn spawn_error(command_line: &str, error: String) -> Self {
        Self {
            kind: OutputKind::Error,
            title: "Could not start axon".to_string(),
            subtitle: command_line.to_string(),
            stdout: None,
            stderr: Some(OutputSection::new("spawn error", error)),
            use_markdown: false,
            compact_stdout: false,
        }
    }

    pub(crate) fn from_process(
        command_line: &str,
        subcommand: &str,
        output: BoundedProcessOutput,
    ) -> Self {
        let use_markdown = matches!(subcommand, "scrape" | "ask" | "research");
        let stdout = OutputSection::from_bytes_for_command(
            "stdout",
            subcommand,
            &output.stdout,
            use_markdown,
        );
        let success = output.status.success();
        let stderr = OutputSection::from_bytes("stderr", &output.stderr).and_then(|section| {
            if success {
                // Axon reserves stderr for progress spinners and logs. In the palette,
                // successful progress noise is not user-facing output.
                None
            } else {
                Some(section.with_text(actionable_error_text(&section.text), false))
            }
        });
        let kind = if success {
            OutputKind::Success
        } else {
            OutputKind::Error
        };
        let title = if success {
            format!("{} completed", command_title(subcommand))
        } else {
            format!("{} failed", command_title(subcommand))
        };
        let subtitle = format!("{command_line} · {}", format_exit_status(&output.status));
        let compact_stdout = success && stderr.is_none();

        Self {
            kind,
            title,
            subtitle,
            stdout,
            stderr,
            use_markdown,
            compact_stdout,
        }
    }

    pub(crate) fn has_body(&self) -> bool {
        self.stdout.is_some() || self.stderr.is_some()
    }
}

impl OutputSection {
    fn from_bytes_for_command(
        label: &'static str,
        subcommand: &str,
        bytes: &[u8],
        use_markdown: bool,
    ) -> Option<Self> {
        Self::from_bytes(label, bytes).map(|section| {
            let section = section.with_text(palette_output_text(subcommand, &section.text), false);
            if use_markdown {
                section.with_markdown()
            } else {
                section
            }
        })
    }

    fn from_bytes(label: &'static str, bytes: &[u8]) -> Option<Self> {
        if bytes.is_empty() {
            return None;
        }
        let raw = String::from_utf8_lossy(bytes);
        Some(Self::new(label, strip_ansi(raw.trim_end())))
    }

    fn new(label: &'static str, text: impl Into<String>) -> Self {
        Self::build(label, truncate_output(text.into()), false)
    }

    fn with_text(&self, text: impl Into<String>, use_markdown: bool) -> Self {
        Self::build(self.label, truncate_output(text.into()), use_markdown)
    }

    fn with_markdown(&self) -> Self {
        Self::build(self.label, self.text.clone(), true)
    }

    fn build(label: &'static str, text: String, use_markdown: bool) -> Self {
        let line_count = text.lines().count().max(1);
        let markdown = use_markdown.then(|| MarkdownDocument::parse(&text));
        let rendered_lines = text
            .lines()
            .take(MAX_RENDER_LINES)
            .map(|line| {
                if line.is_empty() {
                    SharedString::from(" ")
                } else {
                    SharedString::from(line.to_string())
                }
            })
            .collect();
        Self {
            label,
            text,
            line_count,
            rendered_lines,
            markdown,
        }
    }
}

impl OutputKind {
    pub(crate) fn label(self) -> &'static str {
        match self {
            OutputKind::Running => "running",
            OutputKind::Success => "done",
            OutputKind::Warning => "notice",
            OutputKind::Error => "error",
        }
    }

    pub(crate) fn accent_color(self) -> u32 {
        match self {
            OutputKind::Running => AURORA_ACCENT_PRIMARY,
            OutputKind::Success => AURORA_ACCENT_STRONG,
            OutputKind::Warning => AURORA_WARNING,
            OutputKind::Error => AURORA_ACCENT_PINK,
        }
    }
}
