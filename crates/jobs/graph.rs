//! Graph extraction job persistence and schema entry points.

pub(crate) mod context;
pub(crate) mod extract;
mod schema;
pub(crate) mod similarity;
pub(crate) mod taxonomy;
pub(crate) mod worker;

pub use schema::{ensure_graph_schema, ensure_neo4j_schema};
pub use worker::run_graph_worker;

#[cfg(test)]
mod tests {
    #[test]
    fn graph_job_table_name() {
        assert_eq!(
            crate::crates::jobs::common::JobTable::Graph.as_str(),
            "axon_graph_jobs"
        );
    }
}
