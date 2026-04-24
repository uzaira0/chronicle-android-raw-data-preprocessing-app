# Web Deployment

## Chosen Host

The production target for the local-first web app is **Cloudflare Pages**.

This repository uses the static `web/dist` artifact and deploys it with **Cloudflare Pages Direct Upload** from GitHub Actions instead of relying on server-side rendering or a backend API. That matches the current app shape:

- static Vite build output
- service worker for offline use after first load
- local-only browser processing
- no server-side preprocessing path

Cloudflare Pages is the preferred target here because it supports:

- custom response headers via a checked-in `web/public/_headers` file
- preview deployments for non-production branches
- custom domains for the production site
- CI-driven direct uploads using Wrangler

## Required GitHub Settings

Add the following repository settings before expecting automatic deployments:

- repository variable: `CLOUDFLARE_PAGES_PROJECT_NAME`
- repository secret: `CLOUDFLARE_ACCOUNT_ID`
- repository secret: `CLOUDFLARE_API_TOKEN`

The workflow is intentionally fail-safe:

- build and verification still run without Cloudflare credentials
- preview and production deploy steps print a skip message when the required settings are absent

## Workflow

The deployment workflow is defined in:

- `.github/workflows/web-pwa-deploy.yml`

It does the following:

1. installs Python and Node dependencies
2. typechecks the web app
3. runs web unit tests
4. verifies generated contract artifacts are current
5. builds the static web app
6. verifies the built deploy artifact and header policy
7. runs deterministic browser-vs-desktop parity
8. runs Playwright smoke coverage
9. uploads `web/dist` as the release artifact
10. deploys previews on pull requests when Cloudflare credentials are configured
11. deploys production on `main` when Cloudflare credentials are configured

## Header Policy

The checked-in host header policy lives at:

- `web/public/_headers`

That file is copied into the built static artifact and applied by Cloudflare Pages. It is the authoritative deployment-time policy for:

- `Content-Security-Policy`
- `Cross-Origin-Opener-Policy`
- `Cross-Origin-Embedder-Policy`
- `Cross-Origin-Resource-Policy`
- `Origin-Agent-Cluster`
- `Referrer-Policy`
- `X-Content-Type-Options`
- `X-Frame-Options`
- `Permissions-Policy`
- `Strict-Transport-Security`
- cache policy for `index.html`, `sw.js`, `manifest.webmanifest`, and hashed assets

The CSP meta tag in `web/index.html` remains as a local fallback, but deployment headers are the stronger production control.

## Cache Behavior

The current header strategy is:

- `index.html`: `no-store`
- `sw.js`: `no-cache, no-store, must-revalidate`
- `manifest.webmanifest`: `no-cache`
- `/assets/*`: `public, max-age=31536000, immutable`

This keeps the app shell and service worker fresh while allowing hashed build assets to stay aggressively cached.

## Custom Domain Notes

When attaching a custom domain:

- add the domain through the Cloudflare Pages dashboard first
- then let Cloudflare create or validate the required DNS records

If you only want a subdomain, a CNAME to `<project>.pages.dev` is sufficient after the domain is associated in the dashboard. For apex domains, the domain must be on the same Cloudflare account and use Cloudflare nameservers.

## Preview Notes

Preview deployments are created per branch or pull request when the deploy job runs with credentials configured. Preview URLs should be treated as temporary review surfaces, not stable public product URLs.

If preview exposure becomes a concern, enable Cloudflare Access on preview deployments in the Pages project settings.
