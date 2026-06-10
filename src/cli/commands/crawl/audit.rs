//! Thin CLI shim — all audit business logic lives in `src/services/crawl/audit`.
pub(super) use crate::services::crawl::audit::run_crawl_audit;
pub(super) use crate::services::crawl::audit::run_crawl_audit_diff;
