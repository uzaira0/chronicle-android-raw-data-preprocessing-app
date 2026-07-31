import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import Papa from "papaparse";

import appsToFilterUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_to_filter.csv?url";
import appsForcingScreenOpenUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_apps_forcing_screen_open.csv?url";
import backgroundAppsUrl from "@/assets/defaults/Chronicle_Android_raw_data_preprocessor_background_apps.csv?url";
import appCodebookUrl from "@/assets/defaults/unified_app_codebook.csv?url";

type Row = Record<string, string>;

const NOTES: Record<string, string> = {
  apps_to_filter:
    "Engine setting: use filter file. Matching usage is relabelled “Filtered App Usage” — visible but excluded from target minutes, and it closes other apps' sessions. A package also on the background list is constructed-and-marked instead: “Filtered App Background Usage” with real timing, its own deferred category.",
  background_apps:
    "Engine setting: use background apps file. Overlap with the foreground app is split into concurrent (primary/secondary) layers only for these packages.",
  apps_forcing_screen_open:
    "Engine setting: use apps-forcing-screen-open file. Wakelock whitelist — these apps may hold a screen session open past the auto-lock timeout.",
  app_codebook:
    "Engine setting: use app codebook. Joins category/label metadata onto every session (the timeline's category colours). 9k+ packages; search below.",
};

async function fetchCsv(url: string): Promise<Row[]> {
  const text = await (await fetch(url)).text();
  const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
  return parsed.data;
}

function SmallList({
  name,
  url,
  columns,
}: {
  name: string;
  url: string;
  columns: Array<{ key: string; label: string }>;
}): ReactElement {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const firstColumnKey = columns[0]?.key;

  useEffect(() => {
    let active = true;
    fetchCsv(url)
      .then((data) => active && setRows(data))
      .catch((e) => active && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, [url]);

  return (
    <section className="review-alist" data-testid={`applist-${name}`}>
      <h3>
        {name} <small>{rows ? `${rows.length} rows` : "loading…"}</small>
      </h3>
      <p className="review-alist__note">{NOTES[name]}</p>
      {error ? (
        <p className="review-alist__error">Could not load list: {error}</p>
      ) : (
        <table className="review-alist__table">
          <tbody>
            {(rows ?? []).map((row, index) => (
              <tr key={`${(firstColumnKey !== undefined ? row[firstColumnKey] : undefined) ?? index}`}>
                {columns.map((col) => (
                  <td key={col.key}>{row[col.key] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function CodebookList(): ReactElement {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadStarted = useRef(false);

  const ensureLoaded = (): void => {
    if (loadStarted.current) return;
    loadStarted.current = true;
    setLoading(true);
    setError(null);
    fetchCsv(appCodebookUrl)
      .then(setRows)
      .catch((err) => {
        // Surface the failure (matching SmallList) and allow a retry instead of
        // silently leaving an empty table with no explanation.
        setError(err instanceof Error ? err.message : String(err));
        loadStarted.current = false;
      })
      .finally(() => setLoading(false));
  };

  const q = query.trim().toLowerCase();
  const hits =
    rows && q.length >= 2
      ? rows
          .filter(
            (row) =>
              (row.app_package_name ?? "").toLowerCase().includes(q) ||
              (row.application_label ?? "").toLowerCase().includes(q),
          )
          .slice(0, 50)
      : [];

  return (
    <section className="review-alist" data-testid="applist-app_codebook">
      <h3>
        app_codebook <small>9k+ packages</small>
      </h3>
      <p className="review-alist__note">{NOTES.app_codebook}</p>
      <input
        type="search"
        className="input review-alist__search"
        placeholder="search codebook (package or label, 2+ chars)…"
        value={query}
        onFocus={ensureLoaded}
        onChange={(event) => {
          ensureLoaded();
          setQuery(event.target.value);
        }}
        data-testid="applist-codebook-search"
      />
      {loading && !rows ? <p className="review-alist__note">loading codebook…</p> : null}
      {error ? <p className="review-alist__error">Could not load codebook: {error}</p> : null}
      {q.length >= 2 ? (
        <table className="review-alist__table">
          <tbody>
            {hits.map((row, index) => (
              <tr key={`${row.app_package_name ?? index}`}>
                <td>{row.application_label ?? ""}</td>
                <td>{row.app_package_name ?? ""}</td>
                <td>{row.bcm_cnrc_heuristic_category ?? row.bcm_play_store_broad_app_category ?? ""}</td>
              </tr>
            ))}
            {rows && hits.length === 0 ? (
              <tr>
                <td>no matches</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

/** "APP LISTS" subview: the four bundled support files (filter, background,
 * apps-forcing-screen-open, codebook) browsed read-only, with codebook search. */
export function AppListsPanel(): ReactElement {
  return (
    <div className="review-applists" data-testid="review-applists">
      <SmallList
        name="apps_to_filter"
        url={appsToFilterUrl}
        columns={[
          { key: "app_package_name", label: "package" },
          { key: "app_filter_category", label: "category" },
        ]}
      />
      <SmallList
        name="background_apps"
        url={backgroundAppsUrl}
        columns={[
          { key: "package_name", label: "package" },
          { key: "label_or_note", label: "note" },
        ]}
      />
      <SmallList
        name="apps_forcing_screen_open"
        url={appsForcingScreenOpenUrl}
        columns={[
          { key: "package_name", label: "package" },
          { key: "label_or_note", label: "note" },
        ]}
      />
      <CodebookList />
    </div>
  );
}
