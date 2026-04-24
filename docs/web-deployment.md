# Web Deployment

## Chosen Host

For now, the deployment target is **GitHub Pages**.

This repository builds a static Vite artifact from `web/dist`, repackages it for GitHub Pages, and deploys it with the official GitHub Pages Actions workflow. That matches the current app shape:

- static Vite build output
- service worker for offline use after first load
- local-only browser processing
- no server-side preprocessing path

## Why GitHub Pages For Now

GitHub Pages is the simplest host to get live quickly because:

- it is already tied directly to the repository
- it works with the official `configure-pages`, `upload-pages-artifact`, and `deploy-pages` actions
- it supports static hosting and custom domains

The tradeoff is important:

- GitHub Pages does **not** give us the same checked-in response-header control as Cloudflare Pages `_headers`
- the app therefore relies on the CSP meta tag in `web/index.html` instead of host-enforced custom response headers

That is acceptable for now, but it is a weaker deployment posture than the Cloudflare Pages path.

## Workflow

The deployment workflow is defined in:

- `.github/workflows/web-pwa-deploy.yml`

It does the following:

1. installs Python and Node dependencies
2. typechecks the web app
3. runs web unit tests
4. verifies generated contract artifacts are current
5. builds the static web app
6. validates the built `web/dist` artifact, including the Cloudflare-style header artifact we keep in-repo for future host flexibility
7. prepares a GitHub Pages artifact in `web/.github-pages-dist`
8. validates the GitHub Pages artifact
9. runs deterministic browser-vs-desktop parity
10. runs Playwright smoke coverage
11. uploads the Pages artifact
12. deploys it to GitHub Pages on non-PR runs

Pull requests run verification and package the Pages artifact, but do not deploy.

## GitHub Pages Artifact Packaging

The packaging step exists because GitHub Pages and Cloudflare Pages do not consume the same deploy artifact shape.

The preparation script is:

- `web/scripts/prepare_github_pages_artifact.mts`

It:

- copies `web/dist` to `web/.github-pages-dist`
- removes the Cloudflare-only `_headers` file so it is not exposed as a static file
- adds `.nojekyll`

The `.nojekyll` file is included so the Pages artifact is served as plain static content without Jekyll interference.

## Header Model

The repository still keeps:

- `web/public/_headers`

That file is useful for hosts that support checked-in response headers, especially Cloudflare Pages. GitHub Pages does not apply it, so it is removed from the actual Pages deploy artifact.

For the GitHub Pages deployment, the main browser protection is the CSP meta tag in:

- `web/index.html`

That means:

- deploy-time cache and security headers are not as configurable on GitHub Pages
- the GitHub Pages artifact checker only requires the in-document CSP fallback, not `_headers`

## Custom Domain Notes

GitHub Pages supports custom domains. If you attach one, configure it through the repository Pages settings and DNS records for the chosen domain.

GitHub’s docs also recommend verifying your custom domain to reduce takeover risk.

## Privacy Note

The app still processes user files locally in the browser, but GitHub’s docs state that visits to GitHub Pages sites log the visitor IP address for security purposes.

So the strongest truthful statement remains:

- the app code is served by GitHub Pages
- the user’s uploaded files are processed locally in the browser and are not uploaded by the app

## Future Switch Back

If we later want stronger host-enforced browser policy control, the repo still retains the Cloudflare-oriented `_headers` path and can be switched back to Cloudflare Pages without rebuilding the browser app architecture.
