#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NodeBinding {
    pub node_id: &'static str,
    pub capability_id: &'static str,
    pub stage: PhysicalStage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StepBinding {
    pub step_id: &'static str,
    pub unit_id: &'static str,
    pub capability_id: &'static str,
    pub stage: PhysicalStage,
}

include!(concat!(env!("OUT_DIR"), "/capability_registry.rs"));

pub fn node_binding(capability_id: &str) -> Option<&'static NodeBinding> {
    NODE_BINDINGS
        .iter()
        .find(|binding| binding.capability_id == capability_id)
}

pub fn step_binding(capability_id: &str) -> Option<&'static StepBinding> {
    STEP_BINDINGS
        .iter()
        .find(|binding| binding.capability_id == capability_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn complete_compiled_registry_has_no_duplicate_binding() {
        assert_eq!(NODE_BINDINGS.len(), 15);
        assert_eq!(STEP_BINDINGS.len(), 55);
        let capabilities: BTreeSet<_> = NODE_BINDINGS
            .iter()
            .map(|binding| binding.capability_id)
            .chain(STEP_BINDINGS.iter().map(|binding| binding.capability_id))
            .collect();
        assert_eq!(capabilities.len(), 70);
    }
}
