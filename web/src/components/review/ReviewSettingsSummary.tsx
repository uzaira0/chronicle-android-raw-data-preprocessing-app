import type { ReactElement } from "react";

import { BROWSER_PROCESSING_OPTION_KEYS } from "@/lib/generatedContract";
import { isOptionDefault, type OptionKey } from "@/lib/optionDefaults";
import type { DemoDisplayMasker } from "@/lib/demoDisplay";
import type { BrowserProcessingOptions, OutputKind, ProcessedFileResult } from "@/lib/types";

type Props = {
  options: BrowserProcessingOptions;
  result: ProcessedFileResult;
  masker: DemoDisplayMasker;
};

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "(none)";
  if (typeof value === "boolean") return value ? "on" : "off";
  if (value === undefined || value === "") return "(default)";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return "(invalid)";
}

const KIND_LABEL: Record<OutputKind, string> = {
  app: "App usage CSV",
  screen: "Screen usage CSV",
  plot: "Plot / timeline",
  aggregate: "Aggregate",
  parquet: "Parquet",
  spss: "SPSS (.sav)",
  lineage: "Arrow lineage / correspondence",
};

/** "This is what you ran": the options changed from default plus the output
 * files this run produced. Intentionally overlaps ResultPanel — framed as a
 * review confirmation rather than a download surface. */
export function ReviewSettingsSummary({ options, result, masker }: Props): ReactElement {
  const changed = (BROWSER_PROCESSING_OPTION_KEYS as readonly OptionKey[]).filter(
    (key) => !isOptionDefault(key, options[key]),
  );

  const byKind = new Map<OutputKind, { count: number; rows: number }>();
  for (const output of result.outputs) {
    const entry = byKind.get(output.kind) ?? { count: 0, rows: 0 };
    entry.count += 1;
    entry.rows += output.rowCount;
    byKind.set(output.kind, entry);
  }

  return (
    <section className="review-summary" data-testid="review-settings-summary">
      <div className="review-summary__block">
        <h4>Settings used</h4>
        {changed.length === 0 ? (
          <p className="review-summary__muted">All settings at their defaults.</p>
        ) : (
          <ul className="review-summary__list">
            {changed.map((key) => (
              <li key={key}>
                <span className="review-summary__key">{key}</span>
                <span className="review-summary__val">{formatValue(options[key])}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="review-summary__block">
        <h4>Outputs ({masker.fileName(result.inputFileName)})</h4>
        {byKind.size === 0 ? (
          <p className="review-summary__muted">No output files.</p>
        ) : (
          <ul className="review-summary__list">
            {[...byKind.entries()].map(([kind, entry]) => (
              <li key={kind}>
                <span className="review-summary__key">{KIND_LABEL[kind]}</span>
                <span className="review-summary__val">
                  {entry.count} file{entry.count === 1 ? "" : "s"}
                  {entry.rows > 0 ? ` · ${entry.rows} rows` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
