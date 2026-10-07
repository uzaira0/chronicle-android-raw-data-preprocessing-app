// Constructed normalized example, not recovered source rows or a reconstruction.
// Hard Lock Life, SOUPS2014, printed pp218/220: joint states, screen bouts and
// upper-bound unlock cost differ even when supplied endpoint tokens are equal.
export function hardLockStateExample(methodProfileId: string) {
  const owner = {
    method_profile_id: methodProfileId,
    source_work_id: "usenix:soups2014:harbach-hard-lock-life",
    participant_id: "example-participant",
    device_id: "example-device",
    record_origin: "analyst_constructed_example",
    source_locators: ["Hard Lock Life, printed p218 Figure1/Section4.1.1; p220 Section4.2.1"],
  };
  const stateOwner = { ...owner, method_setting_reference: "method-setting-32d5aa038c25a497efc19765" };
  return {
    device_state_observations: [
      { ...stateOwner, state_observation_id: "on-locked", observation_instant: "t0", screen_state: "ON", keyguard_state: "LOCKED" },
      { ...stateOwner, state_observation_id: "on-unlocked", observation_instant: "t1", screen_state: "ON", keyguard_state: "UNLOCKED" },
      { ...stateOwner, state_observation_id: "off-unlocked", observation_instant: "t1", screen_state: "OFF", keyguard_state: "UNLOCKED" },
      { ...stateOwner, state_observation_id: "off-locked", observation_instant: "t2", screen_state: "OFF", keyguard_state: "LOCKED" },
    ],
    device_state_intervals: [
      { ...owner, method_setting_reference: "method-setting-6ed94e8399c28e2d13321eed", state_interval_id: "screen-bout", interval_kind: "screen_bout", denotes_interval: { start_instant: "t0", end_instant: "t1" }, start_observation_ref: "on-locked", end_observation_ref: "off-unlocked" },
      { ...owner, method_setting_reference: "method-setting-210a4202c4b9df1fe287540b", state_interval_id: "unlock-cost", interval_kind: "unlock_cost_upper_bound", denotes_interval: { start_instant: "t0", end_instant: "t1" }, start_observation_ref: "on-locked", end_observation_ref: "on-unlocked" },
    ],
  };
}
