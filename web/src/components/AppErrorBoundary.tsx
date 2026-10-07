import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DiagnosticReportControl } from "@/components/DiagnosticReportControl";
import { LocalDataInventory } from "@/components/LocalDataInventory";
import { recordError } from "@/lib/diagnostics";
import { resetLocalData } from "@/lib/localDataReset";

type Props = { children: ReactNode };
type State = { error: Error | null; resetting: boolean; confirmingReset: boolean };

/**
 * Top-level boot/render safety net. If the app throws while rendering — most
 * importantly while rehydrating a corrupt or oversized cached run — the user
 * would otherwise get a blank page and be stuck. This shows a recovery screen
 * whose first action is a plain reload that keeps every saved item, and a
 * "Clear local data & restart" lifeboat behind a confirmation that lists
 * exactly what it deletes, so a locked-out user can self-recover without
 * opening DevTools and without losing saved projects by one stray click.
 *
 * (A renderer that's been OOM-killed mid-run can't be caught by any boundary;
 * the lightweight-persistence + self-heal paths prevent that loop at the source.
 * This handles every catchable failure on top.)
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetting: false, confirmingReset: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep a console breadcrumb and a local record for the diagnostic report;
    // everything stays on-device.
    console.error("App crashed during render/boot:", error, info.componentStack);
    recordError("render", error, info.componentStack?.trim().split("\n")[0]);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleRequestReset = (): void => {
    this.setState({ confirmingReset: true });
  };

  private handleCancelReset = (): void => {
    this.setState({ confirmingReset: false });
  };

  private handleReset = (): void => {
    this.setState({ resetting: true, confirmingReset: false });
    // Recovery reloads whatever the outcome: a partly failed wipe still frees
    // what it could, and the reloaded app (or this screen again) is the next
    // step either way.
    void resetLocalData().finally(() => {
      window.location.reload();
    });
  };

  render(): ReactNode {
    const { error, resetting, confirmingReset } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="boot-error" role="alert" data-testid="boot-error">
        <div className="boot-error__card">
          <h1 className="boot-error__title">The app couldn’t load</h1>
          <p className="boot-error__body">
            Something went wrong starting up — often a too-full browser storage or a cached run
            that’s too large to reopen. Try reloading first; that keeps everything you saved. If it
            keeps failing, clear this app’s local data and restart. Your raw files are on your
            computer and aren’t affected.
          </p>
          <div className="boot-error__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={this.handleReload}
              disabled={resetting}
              data-testid="boot-error-reload"
            >
              Reload without clearing
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={this.handleRequestReset}
              disabled={resetting}
              data-testid="boot-error-reset"
            >
              {resetting ? "Clearing…" : "Clear local data & restart…"}
            </button>
            <DiagnosticReportControl
              className="btn btn--ghost"
              testId="boot-error-diagnostic-report"
            />
          </div>
          <p className="boot-error__hint">
            Clearing asks for confirmation first. It deletes every processed result, saved project,
            preset, and setting this app keeps in this browser. To report the problem, copy the
            diagnostic report: it describes this browser and the error, never your files.
          </p>
        </div>
        {confirmingReset ? (
          <ConfirmDialog
            title="Delete all of this app’s data in this browser?"
            confirmLabel="Delete everything and restart"
            testId="boot-error-reset-dialog"
            onCancel={this.handleCancelReset}
            onConfirm={this.handleReset}
          >
            <LocalDataInventory />
          </ConfirmDialog>
        ) : null}
      </div>
    );
  }
}
