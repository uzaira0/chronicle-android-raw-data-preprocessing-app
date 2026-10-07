import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const resetLocalData = vi.fn(() => Promise.resolve([]));
vi.mock("@/lib/localDataReset", () => ({ resetLocalData }));

const { AppErrorBoundary } = await import("@/components/AppErrorBoundary");
const { recentErrors, resetRecordedErrors } = await import("@/lib/diagnostics");

type ButtonProps = { "data-testid"?: string; testId?: string; onClick?: () => void; children?: ReactNode };

function findByTestId(node: ReactNode, testId: string): ReactElement<ButtonProps> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByTestId(child as ReactNode, testId);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<ButtonProps>(node)) return null;
  if (node.props["data-testid"] === testId || node.props.testId === testId) return node;
  return findByTestId(node.props.children, testId);
}

function crashedBoundary() {
  const boundary = new AppErrorBoundary({ children: null });
  boundary.state = { error: new Error("boom"), resetting: false, confirmingReset: false };
  boundary.setState = vi.fn((update) => {
    boundary.state = { ...boundary.state, ...(update as object) };
  }) as typeof boundary.setState;
  return boundary;
}

describe("AppErrorBoundary", () => {
  it("offers a reload that keeps saved data as the first action", () => {
    const html = renderToStaticMarkup(crashedBoundary().render() as ReactElement);
    const reload = html.indexOf("Reload without clearing");
    const reset = html.indexOf("Clear local data &amp; restart…");
    expect(reload).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(reload);
  });

  it("records the crash locally and offers the diagnostic report on the crash screen", () => {
    resetRecordedErrors();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const boundary = crashedBoundary();
      boundary.componentDidCatch(new Error("render broke in Raw P01.csv"), {
        componentStack: "\n    at ResultPanel\n    at App",
      });
      expect(recentErrors().at(-1)).toMatchObject({
        source: "render",
        message: "render broke in Raw <file>",
        context: "at ResultPanel",
      });
      expect(findByTestId(boundary.render(), "boot-error-diagnostic-report")).not.toBeNull();
      expect(renderToStaticMarkup(boundary.render() as ReactElement)).toContain("Copy diagnostic report");
    } finally {
      consoleError.mockRestore();
      resetRecordedErrors();
    }
  });

  it("deletes nothing until the listed deletion is confirmed", () => {
    const boundary = crashedBoundary();
    const resetButton = findByTestId(boundary.render(), "boot-error-reset");
    resetButton?.props.onClick?.();

    expect(resetLocalData).not.toHaveBeenCalled();
    expect(boundary.state.confirmingReset).toBe(true);
    expect(findByTestId(boundary.render(), "boot-error-reset-dialog")).not.toBeNull();
  });
});
