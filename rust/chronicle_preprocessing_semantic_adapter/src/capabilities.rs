#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QueryGroupBinding {
    pub query_group_id: &'static str,
    pub capability_id: &'static str,
    pub stage: PhysicalQueryGroup,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct QueryBinding {
    pub query_id: &'static str,
    pub query_group_id: &'static str,
    pub capability_id: &'static str,
    pub entrypoint: &'static str,
    pub tracking: &'static str,
}

include!(concat!(env!("OUT_DIR"), "/capability_registry.rs"));

pub fn query_group_binding(capability_id: &str) -> Option<&'static QueryGroupBinding> {
    QUERY_GROUP_BINDINGS
        .iter()
        .find(|binding| binding.capability_id == capability_id)
}

pub fn query_binding(capability_id: &str) -> Option<&'static QueryBinding> {
    QUERY_BINDINGS
        .iter()
        .find(|binding| binding.capability_id == capability_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn complete_compiled_registry_has_no_duplicate_binding() {
        assert!(!QUERY_GROUP_BINDINGS.is_empty());
        assert!(!QUERY_BINDINGS.is_empty());
        let capabilities: BTreeSet<_> = QUERY_GROUP_BINDINGS
            .iter()
            .map(|binding| binding.capability_id)
            .chain(QUERY_BINDINGS.iter().map(|binding| binding.capability_id))
            .collect();
        assert_eq!(
            capabilities.len(),
            QUERY_GROUP_BINDINGS.len() + QUERY_BINDINGS.len()
        );
    }

    #[test]
    fn compiled_capabilities_resolve_exactly_and_unknown_ids_fail_closed() {
        let group = QUERY_GROUP_BINDINGS.first().expect("query-group binding");
        assert_eq!(query_group_binding(group.capability_id), Some(group));
        let query = QUERY_BINDINGS.first().expect("query binding");
        assert_eq!(query_binding(query.capability_id), Some(query));
        assert_eq!(query_group_binding("urn:unknown:node"), None);
        assert_eq!(query_binding("urn:unknown:query"), None);
    }
}
