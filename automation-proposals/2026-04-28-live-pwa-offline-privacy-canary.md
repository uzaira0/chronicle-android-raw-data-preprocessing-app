# Live PWA Offline And Privacy Canary

Date: 2026-04-28

## Summary

Add a recurring live canary for the deployed GitHub Pages PWA that verifies the
local-first privacy and offline claims after deployment, not only from a freshly
built local artifact.

## Repo evidence

The repo has strong local artifact checks in:

- `.github/workflows/web-pwa-deploy.yml`
- `web/scripts/check_deploy_artifact.mts`
- `web/scripts/prepare_github_pages_artifact.mts`
- `web/public/sw.js`
- `web/e2e/app.spec.ts`
- `docs/web-pwa-acceptance-matrix.md`
- `docs/web-deployment.md`

The deployment doc also notes a real hosting distinction: GitHub Pages does not
apply the checked-in `_headers` file, so the deployed page relies on the CSP
meta tag fallback. That makes live verification valuable because the deployed
host behavior is not identical to the local Cloudflare-style artifact.

## Classification

Deterministic local check / non-LLM schedule. This is not a Codex
automation.

This classification follows `/Users/u/AGENTS.md` Priority 4: deterministic
recurring work belongs in scripts, hooks, CI, launchd, cron, or manual commands,
while Codex/LLM automations are reserved for nondeterministic judgment. It also
preserves Priority 0 and Priority 5 by keeping the check read-only against repo
state and avoiding generated long-lived diffs.

## Proposed mechanism

Create a local Playwright canary script plus a documented manual command. If
repeat scheduling is wanted, run the same command from launchd or cron on this
machine. Do not create a Codex automation or a GitHub Actions workflow for this
local test/check surface.

The script opens the live GitHub Pages URL and:

1. Records all network requests from page and service-worker contexts.
2. Confirms no external HTTP(S) requests occur during initial load or sample
   local processing.
3. Waits for service-worker activation and confirms shell control.
4. Warms the cache, switches offline, reloads, and processes the sample fixture.
5. Confirms expected artifact files are still downloadable or generated.
6. Captures a small evidence bundle: request log, CSP observed in DOM, service
   worker state, screenshots only on failure, and output row counts.

## Trigger

- Manual operator command after a public PWA deployment.
- Optional launchd/cron schedule against the live GitHub Pages URL.

## Inputs

- Live PWA URL.
- Checked-in sample fixture used by the web E2E/local-processing path.
- Browser context configured to record page and service-worker requests.

## Outputs

- Request log.
- Service-worker state.
- CSP observed in the DOM.
- Offline reload result.
- Output row counts or generated artifact names.
- Failure-only screenshot bundle.

## Stop condition

Stop once the live URL is offline-capable, service-worker controlled, and has no
unexpected external HTTP(S) requests during the bounded fixture run, or once a
specific reproducible failure is recorded.

## Failure reporting

Print a compact local report with the failed assertion, URL, request list,
service-worker state, and reproduction command. Escalate to Codex only when the
failure requires diagnosis or code repair rather than rerunning the canary.

## Why LLM judgment is not required

The checks are fully assertable from browser events, service-worker state,
offline reload behavior, and generated output counts. `/Users/u/AGENTS.md`
Priority 4 says this belongs in deterministic automation; LLM judgment is only
useful later for interpreting a failed run and choosing a fix.

## Why it helps

Local artifact checks are necessary but do not fully cover the public deployment
environment. This canary catches service-worker cache mistakes, path/base URL
issues, accidental remote runtime dependencies, and missing CSP fallback before
users rely on the public app for local-only preprocessing.

## Duplicate-risk review

This is not a replacement for the existing Playwright E2E suite. It is a live
post-deploy canary scoped to deployed hosting behavior, service-worker control,
offline reload, and request egress.

## External references reviewed

- Playwright documents service-worker activation, service-worker request events,
  and routing behavior needed for this kind of canary:
  https://playwright.dev/docs/service-workers
- The web deployment doc in this repo explains why GitHub Pages and
  Cloudflare-style artifacts differ: `docs/web-deployment.md`
