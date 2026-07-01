//! Source adapter registry.

use std::sync::Arc;

use axon_api::source::*;

use crate::adapter::SourceAdapter;

#[derive(Clone, Default)]
pub struct SourceAdapterRegistry {
    adapters: Vec<Arc<dyn SourceAdapter>>,
}

impl SourceAdapterRegistry {
    pub fn from_adapters<A>(adapters: Vec<A>) -> Self
    where
        A: SourceAdapter + 'static,
    {
        let mut adapters = adapters
            .into_iter()
            .map(|adapter| Arc::new(adapter) as Arc<dyn SourceAdapter>)
            .collect::<Vec<_>>();
        adapters.sort_by(|left, right| left.name().cmp(right.name()));
        Self { adapters }
    }

    pub fn adapter_for(&self, route: &RoutePlan) -> Option<Arc<dyn SourceAdapter>> {
        self.adapters
            .iter()
            .find(|adapter| adapter.name() == route.adapter.name)
            .cloned()
    }
}
