// Lighthouse CI gate (local pre-push hook via scripts/check-lighthouse.sh).
// Explicit assertions only — no `preset`. The lighthouse:no-pwa preset turns
// every recommended audit into an error, which contradicts deliberate
// properties of this app:
//   - is-crawlable: robots.txt/noindex is intentional — a local research-data
//     tool has no business being indexed.
//   - valid-source-maps: production builds deliberately ship no source maps.
//   - unused-javascript: the wasm runtime and heavy panels are lazy-loaded;
//     first-paint always carries some not-yet-executed code.
//   - network-dependency-tree-insight: informational insight, not a defect.
// The pwa category no longer exists in Lighthouse 12, so it is not asserted.
module.exports = {
  ci: {
    collect: {
      staticDistDir: "./dist",
      numberOfRuns: 1,
      settings: {
        onlyCategories: ["performance", "accessibility", "best-practices", "seo"],
        formFactor: "desktop",
        screenEmulation: {
          mobile: false,
          width: 1280,
          height: 720,
          deviceScaleFactor: 1,
        },
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["warn", { minScore: 0.6 }],
        "categories:accessibility": ["error", { minScore: 0.9 }],
        "categories:best-practices": ["warn", { minScore: 0.85 }],
        "categories:seo": ["warn", { minScore: 0.5 }],
        // Real-defect audits stay hard errors: contrast regressions and
        // console errors have both shipped before (dark-theme accent pills,
        // offline.html favicon 404).
        "color-contrast": ["error", { minScore: 1 }],
        "errors-in-console": ["error", { minScore: 1 }],
        interactive: ["warn", { maxNumericValue: 8000 }],
        "first-contentful-paint": ["warn", { maxNumericValue: 4000 }],
        "total-blocking-time": ["warn", { maxNumericValue: 600 }],
      },
    },
    upload: {
      target: "filesystem",
      outputDir: "./.lighthouse-results",
    },
  },
};
