import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

import { resetLocalData } from "@/lib/localDataReset";

type Props = { children: ReactNode };
type State = { error: Error | null; resetting: boolean };

/**
 * Top-level boot/render safety net. If the app throws while rendering — most
 * importantly while rehydrating a corrupt or oversized cached run — the user
 * would otherwise get a blank page and be stuck. This shows a recovery screen
 * with a plain Reload *and* a "Clear local data & restart" lifeboat, so a
 * locked-out user can self-recover without opening DevTools.
 *
 * (A renderer that's been OOM-killed mid-run can't be caught by any boundary;
 * the lightweight-persistence + self-heal paths prevent that loop at the source.
 * This handles every catchable failure on top.)
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, resetting: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep a console breadcrumb; everything stays on-device.
    console.error("App crashed during render/boot:", error, info.componentStack);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  private handleReset = (): void => {
    this.setState({ resetting: true });
    void resetLocalData().finally(() => {
      window.location.reload();
    });
  };

  render(): ReactNode {
    const { error, resetting } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="boot-error" role="alert" data-testid="boot-error">
        <div className="boot-error__card">
          <h1 className="boot-error__title">The app couldn’t load</h1>
          <p className="boot-error__body">
            Something went wrong starting up — often a too-full browser storage or a cached run
            that’s too large to reopen. Try reloading first. If it keeps failing, clear this site’s
            local data and restart; your files are on your computer and aren’t affected.
          </p>
          <div className="boot-error__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={this.handleReload}
              disabled={resetting}
              data-testid="boot-error-reload"
            >
              Reload
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={this.handleReset}
              disabled={resetting}
              data-testid="boot-error-reset"
            >
              {resetting ? "Clearing…" : "Clear local data & restart"}
            </button>
          </div>
          <p className="boot-error__hint">
            Clearing removes cached results, saved projects, and saved settings for this site only.
          </p>
        </div>
      </div>
    );
  }
}
