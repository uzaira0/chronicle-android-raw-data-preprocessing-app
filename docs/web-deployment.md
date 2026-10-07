# Web Deployment

The app is a static Vite build served by **GitHub Pages**. There are two sites, one per
GitHub repository, and neither is updated by merging a PR.

| Site | Repository | Pages source | URL | How it is published |
|---|---|---|---|---|
| Production | `uzaira0/chronicle-android-raw-data-preprocessing-app` (public, git remote `public`) | GitHub Actions (`build_type: workflow`) | <https://uzaira0.github.io/chronicle-android-raw-data-preprocessing-app/> | Manual dispatch of `.github/workflows/web-pwa-deploy.yml` |
| Preview | `uzaira0/chronicle-android-preprocessing-app-preview` (private, git remote `origin`) | `gh-pages` branch at `/` (`build_type: legacy`) | <https://uzaira0.github.io/chronicle-android-preprocessing-app-preview/> | A commit pushed to `gh-pages` |

Development lands on the preview repository's `main`. The production repository's `main`
stopped at PR #100 (2026-08-06) apart from Dependabot. Publishing to production is an
explicit decision, never a side effect of merging.

Both sites share the `https://uzaira0.github.io` origin, so they share localStorage,
IndexedDB, OPFS and Cache Storage. A preview build opens the same browser stores as
production for anyone who has visited both.

## What the deploy workflow does

`.github/workflows/web-pwa-deploy.yml` has a single trigger, `workflow_dispatch`. It
**runs no tests**. Its steps are:

1. `actions/checkout` of the dispatched ref
2. `actions/configure-pages`
3. `actions/setup-node` with `web/.node-version`
4. `npm ci` in `web/`
5. `npm run build:app`. This builds from the WASM packages committed under
   `web/src/wasm/*/pkg/` and does not compile Rust. The runner cannot resolve the
   private `semantic-profile-toolchain` crates, so `npm run build`, which includes
   `build:wasm`, cannot run there.
6. `anchore/sbom-action/download-syft` (syft 1.49.0), then `scripts/generate-sbom.sh`,
   which writes the CycloneDX SBOM `web/dist/sbom.cdx.json` from the committed lockfiles
7. `npm run prepare:github-pages`, which copies `web/dist` to `web/.github-pages-dist`,
   removes `_headers` and adds `.nojekyll` (`web/scripts/prepare_github_pages_artifact.mts`)
8. `npm run check:github-pages-artifact`, the bundle-budget and artifact-shape check
   (including the SBOM)
9. `actions/upload-pages-artifact` from `web/.github-pages-dist`
10. `actions/deploy-pages` into the `github-pages` environment

The `github-pages` environment of the production repository only accepts deployments
from the `main` branch (custom deployment branch policy `main`). Dispatching from any
other ref fails at step 10 until a branch policy for that ref is added (see Rollback).

The real gate is local. Run `make all` on the exact commit you intend to deploy: CI
(Rust tests and scanners), the web checks, the e2e smoke and `deploy-artifact`
(`npm run build:app`, `scripts/generate-sbom.sh`, `npm run check:deploy-artifact`). The workflow does not check
that the commit passed it.

## Deploying to production

```bash
# 1. Gate the exact commit locally
make all > make-all.log 2>&1; echo "exit=$?"

# 2. Bring that commit to the production repository's main (an explicit decision).
#    main there is protected (enforce_admins) and carries Dependabot commits the
#    preview repo does not, so it lands through a PR, not a direct push.
git push public <commit>:refs/heads/release/$(date +%Y-%m-%d)
gh pr create -R uzaira0/chronicle-android-raw-data-preprocessing-app \
  --base main --head release/$(date +%Y-%m-%d) --title "Release $(date +%Y-%m-%d)" --body "<what changed>"
gh pr merge -R uzaira0/chronicle-android-raw-data-preprocessing-app --squash <pr-number>

# 3. Tag the merged main commit that is about to go live, so it can be redeployed later
git fetch public main
git tag deployed-$(date +%Y-%m-%d) FETCH_HEAD
git push public deployed-$(date +%Y-%m-%d)

# 4. Dispatch the deploy and watch it
gh workflow run web-pwa-deploy.yml -R uzaira0/chronicle-android-raw-data-preprocessing-app --ref main
gh run watch -R uzaira0/chronicle-android-raw-data-preprocessing-app \
  "$(gh run list -R uzaira0/chronicle-android-raw-data-preprocessing-app \
       --workflow web-pwa-deploy.yml -L 1 --json databaseId --jq '.[0].databaseId')"
```

Then confirm what is live (next section). The 6-hourly `canary.yml` in the production
repository runs the `@smoke` suite against the production URL.

## Finding what is live

**Production.** The GitHub deployments API records the commit for every Pages
deployment:

```bash
gh api 'repos/uzaira0/chronicle-android-raw-data-preprocessing-app/deployments?environment=github-pages&per_page=5' \
  --jq '.[] | {sha: .sha[0:8], ref, created_at}'
```

The first entry is live. As of 2026-10-03 that is `e16d4abb` (`main`, PR #97,
2026-08-05T08:23:55Z). Cross-check against the served file:

```bash
curl -sI https://uzaira0.github.io/chronicle-android-raw-data-preprocessing-app/ | grep -i last-modified
# last-modified: Wed, 05 Aug 2026 08:24:10 GMT  (seconds after the deployment above)
```

The workflow run list (`gh run list -R uzaira0/chronicle-android-raw-data-preprocessing-app
--workflow web-pwa-deploy.yml`) shows the head branch and SHA of each dispatch, including
failed ones that never went live.

**Preview.** Each publish is one commit on `gh-pages` whose message names the source
commit, for example `deploy: Download all ZIP leaves out a plot it cannot draw (35b9b2b80)`:

```bash
gh api repos/uzaira0/chronicle-android-preprocessing-app-preview/branches/gh-pages \
  --jq '.commit | {sha: .sha[0:9], msg: .commit.message, date: .commit.committer.date}'
```

## Rollback

### Production: redeploy an earlier commit

The dispatch runs the workflow file **as it exists at the dispatched ref** and builds that
ref's committed WASM packages. Any earlier commit that has `web-pwa-deploy.yml` with a
`workflow_dispatch` trigger can be redeployed. This was done on 2026-07-29 with
`rollback/2026-06-27-build`.

```bash
REPO=uzaira0/chronicle-android-raw-data-preprocessing-app
GOOD=<known-good commit or deployed-* tag>

# 1. A branch at the known-good commit (the environment accepts branches, not tags)
git push public "$GOOD":refs/heads/rollback/$(date +%Y-%m-%d)

# 2. Allow that branch to deploy into github-pages
gh api -X POST repos/$REPO/environments/github-pages/deployment-branch-policies \
  -f name='rollback/*' -f type=branch

# 3. Dispatch from the rollback branch and watch it
gh workflow run web-pwa-deploy.yml -R $REPO --ref rollback/$(date +%Y-%m-%d)
gh run list -R $REPO --workflow web-pwa-deploy.yml -L 1

# 4. Confirm the deployments API now lists the rollback SHA first (see above)

# 5. Remove the extra branch policy so only main can deploy again
gh api repos/$REPO/environments/github-pages/deployment-branch-policies \
  --jq '.branch_policies[] | select(.name == "rollback/*") | .id' \
  | xargs -I{} gh api -X DELETE repos/$REPO/environments/github-pages/deployment-branch-policies/{}
```

Known-good candidates are the commits in the deployments API history and the
`deployed-*` tags (`deployed-2026-06-27-build`).

**On-device data after a rollback.** An older build reads browser data that a newer build
wrote. The settings store carries `SETTINGS_SCHEMA_VERSION` (15 on current `main`, 2 at
`e16d4abb`), and IndexedDB projects, the last-run store and OPFS workspaces have their own
formats. Before rolling back across a schema change, load the target build in a browser
profile that holds data from the current build and confirm it opens without errors. If it
does not, tell users to clear site data for `uzaira0.github.io`, which also clears the
preview and every other Pages app on that origin.

Open tabs keep running the build they loaded. Navigations are network-first in
`web/public/sw.js`, so the next page load fetches the deployed build, and the app shows its
"new version available" reload banner once the new service worker takes control.

### Preview: republish an earlier build

`gh-pages` keeps every published build as a commit. To go back, reset the branch to the
earlier deploy commit and force-push it. Pages republishes it.

```bash
git fetch origin gh-pages
git log --oneline origin/gh-pages | head          # pick the deploy commit to restore
git push --force-with-lease=gh-pages origin <deploy-commit>:gh-pages
```

Never push source, docs or campaign commits to `gh-pages`. Deleting the branch takes the
preview site down.

## GitHub Pages artifact packaging

The preparation script is `web/scripts/prepare_github_pages_artifact.mts`. It copies
`web/dist` to `web/.github-pages-dist`, removes the Cloudflare-only `_headers` file and
adds `.nojekyll`, so the artifact is served as plain static content. It fails if
`index.html` lacks the CSP meta tag.

## Header model

`web/public/_headers` holds the full header set (CSP with `frame-ancestors`, HSTS, COOP,
Permissions-Policy) for hosts that honor it, such as Cloudflare Pages or Netlify. GitHub
Pages does not apply it, and it is removed from the production artifact.

On GitHub Pages the browser protections come from `web/index.html`:

- the `Content-Security-Policy` meta tag (`default-src 'self'`, `connect-src 'self'`,
  `script-src 'self' 'wasm-unsafe-eval'`)
- `<meta name="referrer" content="no-referrer">`

A meta CSP cannot carry `frame-ancestors`, so the GitHub Pages site can be framed. The
GitHub Pages artifact checker requires only the in-document CSP, not `_headers`.

## Custom domain

GitHub Pages supports custom domains through the repository Pages settings and DNS. A
dedicated domain would give the production app its own origin, separate from the preview
and the other `uzaira0.github.io` sites. Verify the domain in GitHub to prevent takeover.

## Third-party notices

`npm run build:app` writes `THIRD-PARTY-NOTICES.txt` to the root of `web/dist`, so both
sites serve it at `<site URL>/THIRD-PARTY-NOTICES.txt`. It holds the license text of every
bundled npm production package, every Rust crate linked into the WASM packages (including
the Apache `NOTICE` files of `arrow-*` and `parquet`), and the MIT notices of ported code.
Built by `web/scripts/third_party_notices.mts`; the Rust part is the committed `web/third-party/rust-wasm-crates.txt`, regenerated by `npm run build:wasm` (`web/scripts/rust_wasm_notices.mjs`) and drift-checked by `make wasm-fresh`.

## SBOM

`scripts/generate-sbom.sh` writes `sbom.cdx.json` (CycloneDX) to the root of `web/dist`
after the build, so both sites serve it at `<site URL>/sbom.cdx.json`. syft reads
`web/package-lock.json` (production entries) and the `Cargo.lock` of the two WASM crates;
the Rust part is narrowed to the crates in `web/third-party/rust-wasm-crates.txt`, the same
list the notices use. The timestamp is the HEAD commit time and the serial number is
derived from the component list, so the same commit yields the same file. The app never
fetches or precaches it. `check:deploy-artifact` fails when it is missing, is not
CycloneDX, or omits a package `THIRD-PARTY-NOTICES.txt` says ships. Scan it with
`grype sbom:web/dist/sbom.cdx.json`.

## Privacy note

GitHub's documentation states that visits to GitHub Pages sites log the visitor IP address
for security purposes. The app code is served by GitHub Pages. Uploaded files are
processed locally in the browser and are not uploaded by the app.
