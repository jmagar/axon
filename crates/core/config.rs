mod cli;
mod help;
mod parse;
mod types;

pub use parse::parse_args;
pub use types::{CommandKind, Config, PerformanceProfile, RenderMode, ScrapeFormat};
