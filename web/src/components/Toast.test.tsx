import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Toast } from "@/components/Toast";

describe("Toast", () => {
  it("announces an error as an alert", () => {
    const html = renderToStaticMarkup(
      createElement(Toast, { message: "Could not save", isError: true, onDismiss: vi.fn() }),
    );
    expect(html).toMatch(/^<div class="toast is-error" role="alert"/);
    expect(html).toContain("Could not save");
  });

  it("announces a success politely as a status", () => {
    const html = renderToStaticMarkup(
      createElement(Toast, { message: "Saved", onDismiss: vi.fn() }),
    );
    expect(html).toMatch(/^<div class="toast" role="status" aria-live="polite"/);
    expect(html).not.toContain('role="alert"');
  });
});
