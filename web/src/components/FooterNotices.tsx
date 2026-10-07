import type { ReactElement } from "react";

export const SOURCE_REPOSITORY_URL =
  "https://github.com/uzaira0/chronicle-android-raw-data-preprocessing-app";
export const LICENSE_URL = `${SOURCE_REPOSITORY_URL}/blob/main/LICENSE`;
export const UPSTREAM_REPOSITORY_URL =
  "https://github.com/methodic-labs/chronicle-processing";
export const GITHUB_PRIVACY_STATEMENT_URL =
  "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement";

/** Written into the build output root by the release build. */
export function thirdPartyNoticesUrl(baseUrl: string): string {
  return `${baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`}THIRD-PARTY-NOTICES.txt`;
}

/** The exact commit this build came from, when the build stamped a real sha. */
export function buildSourceUrl(buildSha: string): string | null {
  return /^[0-9a-f]{7,40}$/.test(buildSha)
    ? `${SOURCE_REPOSITORY_URL}/tree/${buildSha}`
    : null;
}

type Props = {
  buildSha: string;
  baseUrl: string;
  onDeleteAllLocalData: () => void;
  /** True while a run, retry or comparison is writing local storage. */
  deleteDisabled: boolean;
};

/**
 * Privacy notice, terms and license notices (GPL-3.0 §5(d) "Appropriate Legal
 * Notices") shown on every page. Every statement here is about this build's
 * actual behavior: processing is local (no request carries file data), the
 * host is GitHub Pages, and the stores named are the ones the app writes
 * (`lib/localDataReset.ts` lists and deletes them).
 */
export function FooterNotices({
  buildSha,
  baseUrl,
  onDeleteAllLocalData,
  deleteDisabled,
}: Props): ReactElement {
  const buildUrl = buildSourceUrl(buildSha);
  return (
    <section
      className="app-footer__notices"
      aria-labelledby="footer-notices-title"
      data-testid="footer-notices"
    >
      <h2 id="footer-notices-title" className="visually-hidden">
        Privacy, terms and license
      </h2>
      <p data-testid="privacy-notice">
        <strong>Privacy.</strong> Files you open are processed on this device, inside this
        browser; nothing you load or produce is uploaded, and the app has no analytics and sets
        no cookies. The site is hosted on GitHub Pages: GitHub, Inc. receives each visitor’s IP
        address and browser details when it serves the page (
        <a href={GITHUB_PRIVACY_STATEMENT_URL} target="_blank" rel="noreferrer noopener">
          GitHub privacy statement
        </a>
        ). Processed results, the cached last run, saved projects, settings, presets and a log of
        recent errors (for the diagnostic report you can copy) stay in
        this browser’s storage (origin-private file storage, IndexedDB and localStorage) until
        you delete them with “Delete results”, with{" "}
        <button
          type="button"
          className="app-footer__cache-reset"
          data-testid="delete-all-local-data"
          disabled={deleteDisabled}
          onClick={onDeleteAllLocalData}
        >
          Delete all local data…
        </button>
        , or in your browser’s site-data settings. The operator of this site receives no
        participant data; researchers remain responsible for the consent and data-protection
        obligations of the files they open.
      </p>
      <p data-testid="terms-notice">
        <strong>Terms.</strong> For research use only; not a medical or clinical device. Provided
        “as is”, without warranty of any kind. Check outputs before relying on them.
      </p>
      <p data-testid="license-notice">
        © 2026 Uzair Alam and contributors. Free software under the GNU General Public License
        version 3 (GPL-3.0); includes code derived from{" "}
        <a href={UPSTREAM_REPOSITORY_URL} target="_blank" rel="noreferrer noopener">
          methodic-labs/chronicle-processing
        </a>{" "}
        (GPL-3.0). This program comes with ABSOLUTELY NO WARRANTY. You may redistribute it and
        modify it under the terms of the GPL.{" "}
        <a href={LICENSE_URL} target="_blank" rel="noreferrer noopener">
          License (GPL-3.0)
        </a>{" "}
        ·{" "}
        <a href={SOURCE_REPOSITORY_URL} target="_blank" rel="noreferrer noopener">
          Source code
        </a>
        {buildUrl ? (
          <>
            {" "}
            (
            <a href={buildUrl} target="_blank" rel="noreferrer noopener">
              this build
            </a>
            )
          </>
        ) : null}{" "}
        ·{" "}
        <a href={thirdPartyNoticesUrl(baseUrl)} target="_blank" rel="noreferrer noopener">
          Third-party notices
        </a>
      </p>
      <p data-testid="affiliation-notice">
        Not affiliated with, or endorsed by, Methodic or Chronicle.
      </p>
    </section>
  );
}
