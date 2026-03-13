use crate::crates::jobs::ingest::IngestSource;
use std::error::Error;

pub fn classify_target(target: &str, include_source: bool) -> Result<IngestSource, Box<dyn Error>> {
    crate::crates::ingest::classify::classify_target(target, include_source)
}
