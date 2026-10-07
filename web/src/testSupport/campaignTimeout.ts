/// Wall-clock budget for the long dependency-evidence campaign tests.
///
/// 30 minutes is the committed default and is ample on an idle machine: a
/// single configuration-influence shard measures about 150 s on its own.
///
/// It is overridable because the budget is a property of the MACHINE, not of
/// the campaign. `make dependency-evidence` starts four campaigns at once — a
/// covering run plus three sharded ones — so at four workers thirteen WASM
/// processes compete with each other and with whatever else the box is
/// carrying. On a shared machine already running at several times its core
/// count the same shard stretches by more than an order of magnitude. Raise it
/// there through the environment rather than committing a larger number, so a
/// genuine cost regression still fails fast for everyone else.
export const CAMPAIGN_TEST_TIMEOUT_MS = Number(
  process.env.CAMPAIGN_TEST_TIMEOUT_MS ?? "1800000",
);

if (
  !Number.isSafeInteger(CAMPAIGN_TEST_TIMEOUT_MS) ||
  CAMPAIGN_TEST_TIMEOUT_MS < 1
) {
  throw new Error("CAMPAIGN_TEST_TIMEOUT_MS must be a positive integer");
}
