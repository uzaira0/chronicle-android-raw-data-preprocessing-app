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

  it("renders technical details collapsed inside an error alert", () => {
    const html = renderToStaticMarkup(
      createElement(Toast, {
        message: "Could not save",
        details: "Storage detail",
        isError: true,
        onDismiss: vi.fn(),
      }),
    );
    expect(html).toContain('<details class="technical-details"><summary>Technical details</summary><pre>Storage detail</pre></details>');
    expect(html).not.toContain("<details open");
  });

  it("announces a success politely as a status", () => {
    const html = renderToStaticMarkup(
      createElement(Toast, { message: "Saved", onDismiss: vi.fn() }),
    );
    expect(html).toMatch(/^<div class="toast" role="status" aria-live="polite"/);
    expect(html).not.toContain('role="alert"');
  });
});
