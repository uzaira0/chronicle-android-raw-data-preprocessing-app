/**
 * The one download-at-a-time state machine behind ResultPanel's download
 * buttons. Extracted so the three invariants the UI relies on are unit-tested
 * without component-test infrastructure:
 *
 * 1. a second request while one is active is ignored (re-entrancy guard);
 * 2. a failure is reported as a message, never thrown to React;
 * 3. the busy marker is always released, success or failure.
 */
export type ExclusiveDownloadHooks = {
  isBusy: () => boolean;
  markBusy: (id: string) => void;
  markIdle: () => void;
  reportError: (message: string | null) => void;
};

export function startExclusiveDownload(
  hooks: ExclusiveDownloadHooks,
  id: string,
  work: () => Promise<void>,
): Promise<void> | undefined {
  if (hooks.isBusy()) return undefined;
  hooks.markBusy(id);
  hooks.reportError(null);
  return (async () => {
    try {
      await work();
    } catch (failure) {
      hooks.reportError(
        failure instanceof Error ? failure.message : String(failure),
      );
    } finally {
      hooks.markIdle();
    }
  })();
}
