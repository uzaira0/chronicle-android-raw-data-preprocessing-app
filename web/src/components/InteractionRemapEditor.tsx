import type { ReactElement } from "react";

import { SettingsField } from "@/components/SettingsField";
import type { TooltipContent } from "@/components/Tooltip";
import {
  CANONICAL_INTERACTION_TYPES,
  INTERACTION_REMAP_DELIMITER,
} from "@/lib/interactionTypes";

type Props = {
  value: string[];
  onChange: (next: string[]) => void;
  tooltip?: TooltipContent;
  modified?: boolean;
  onReset?: () => void;
};

type Row = { from: string; to: string };

/**
 * Decode the stored `"Raw=>Canonical"` entries into editable rows. An entry
 * without the delimiter is a partial row the user is still typing (`to` empty).
 */
function toRows(entries: string[]): Row[] {
  return entries.map((entry) => {
    const at = entry.indexOf(INTERACTION_REMAP_DELIMITER);
    if (at === -1) return { from: entry, to: "" };
    return {
      from: entry.slice(0, at),
      to: entry.slice(at + INTERACTION_REMAP_DELIMITER.length),
    };
  });
}

/** A row with a chosen target serializes with the delimiter; otherwise just `from`. */
function serialize(row: Row): string {
  return row.to ? `${row.from}${INTERACTION_REMAP_DELIMITER}${row.to}` : row.from;
}

export function InteractionRemapEditor({
  value,
  onChange,
  tooltip,
  modified,
  onReset,
}: Props): ReactElement {
  const rows = toRows(value);

  const setRow = (index: number, next: Row): void => {
    const copy = rows.slice();
    copy[index] = next;
    onChange(copy.map(serialize));
  };
  const addRow = (): void => onChange([...value, ""]);
  const removeRow = (index: number): void =>
    onChange(rows.filter((_, rowIndex) => rowIndex !== index).map(serialize));

  return (
    <SettingsField
      label="Custom interaction-type mappings"
      tooltip={tooltip}
      modified={modified}
      onReset={onReset}
    >
      <div className="remap-editor" data-testid="interaction-remap-editor">
        {rows.length === 0 ? (
          <p className="remap-editor__empty">
            No custom mappings. Add one to translate a vendor-specific interaction type onto a
            canonical name the pipeline understands.
          </p>
        ) : null}
        {rows.map((row, index) => (
          <div className="remap-editor__row" key={index}>
            <input
              type="text"
              className="input remap-editor__from"
              placeholder="Raw interaction type"
              aria-label={`Raw interaction type ${index + 1}`}
              data-testid={`remap-from-${index}`}
              value={row.from}
              onChange={(event) => setRow(index, { ...row, from: event.target.value })}
            />
            <span className="remap-editor__arrow" aria-hidden="true">
              →
            </span>
            <select
              className="input remap-editor__to"
              aria-label={`Canonical type ${index + 1}`}
              data-testid={`remap-to-${index}`}
              value={row.to}
              onChange={(event) => setRow(index, { ...row, to: event.target.value })}
            >
              <option value="">Select canonical type…</option>
              {CANONICAL_INTERACTION_TYPES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn--danger-ghost remap-editor__remove"
              data-testid={`remap-remove-${index}`}
              aria-label={`Remove mapping ${index + 1}`}
              onClick={() => removeRow(index)}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn--secondary remap-editor__add"
          data-testid="remap-add"
          onClick={addRow}
        >
          + Add mapping
        </button>
      </div>
    </SettingsField>
  );
}
