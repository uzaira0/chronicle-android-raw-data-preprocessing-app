use super::{
    BTreeMap, BTreeSet, HashMap, RawRow, Row, MatcherInput, MatcherOutput,
    EpisodeReconstructionStrategy, OpenerSet, MicroUseClassificationPolicy,
    MinimumDurationComparator, MinimumDurationDisposition, ScreenSessionClose,
    ScreenClassificationSettings, source, reconstruction, screen, b06,
};

/// Immutable computation dependencies, fixed for a run or database lifetime.
/// Non-production functions carry no certified implementation identity.
#[derive(Clone, Copy)]
#[allow(clippy::type_complexity)]
pub struct StageFunctions {
    pub decode_source_records: fn(&[u8]) -> Vec<RawRow>,
    pub canonicalize_source_rows: fn(&[RawRow], &str, &BTreeMap<String, String>, &BTreeMap<String, String>) -> Result<Vec<Row>, String>,
    pub match_app_episodes_with_strategy: fn(&MatcherInput, &[Row], EpisodeReconstructionStrategy, OpenerSet, bool, bool, bool, i64, i64) -> Result<MatcherOutput, String>,
    pub classify_episode_durations: fn(Vec<Row>, &BTreeSet<String>, MicroUseClassificationPolicy, f64, MinimumDurationComparator, MinimumDurationDisposition, &[usize], &b06::MaximumDurationRowStage) -> Result<Vec<Row>, String>,
    pub classify_screen_sessions: fn(&[Row], &[ScreenSessionClose], &BTreeMap<String, Vec<i64>>, &HashMap<String, String>, ScreenClassificationSettings) -> Vec<Row>,
}

impl StageFunctions {
    pub const fn production() -> Self {
        Self {
            decode_source_records: source::decode_source_records,
            canonicalize_source_rows: source::canonicalize_source_rows,
            match_app_episodes_with_strategy: reconstruction::match_app_episodes_with_strategy,
            classify_episode_durations: reconstruction::classify_episode_durations,
            classify_screen_sessions: screen::classify_screen_sessions,
        }
    }
}

impl Default for StageFunctions {
    fn default() -> Self { Self::production() }
}
