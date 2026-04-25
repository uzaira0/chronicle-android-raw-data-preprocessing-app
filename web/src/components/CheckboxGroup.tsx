import { useMemo, useState } from "react";
import type { ReactElement } from "react";

import { Tooltip, type TooltipContent } from "@/components/Tooltip";

export type CheckboxOption = { label: string; value: string };

type CheckboxGroupProps = {
  title: string;
  options: CheckboxOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  tooltip?: TooltipContent;
  modified?: boolean;
  onReset?: () => void;
  searchable?: boolean;
};

export function CheckboxGroup({
  title,
  options,
  selected,
  onChange,
  tooltip,
  modified = false,
  onReset,
  searchable = false,
}: CheckboxGroupProps): ReactElement {
  const [filter, setFilter] = useState("");
  const filtered = useMemo(() => {
    if (!searchable || !filter.trim()) return options;
    const needle = filter.trim().toLowerCase();
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [filter, options, searchable]);

  const toggle = (value: string, on: boolean) => {
    if (on) {
      if (selected.includes(value)) return;
      onChange([...selected, value]);
    } else {
      onChange(selected.filter((entry) => entry !== value));
    }
  };

  return (
    <div className="checkbox-group">
      <div className="settings-field__label-row u-mb-1">
        <span className="checkbox-group__title">{title}</span>
        <Tooltip content={tooltip} label={`Help: ${title}`} />
        <span className={`settings-field__indicator${modified ? " is-modified" : ""}`}>
          {modified ? <span aria-hidden="true">●</span> : null}
          {modified && onReset ? (
            <button
              type="button"
              className="settings-field__reset"
              aria-label={`Reset ${title} to default`}
              onClick={onReset}
            >
              ×
            </button>
          ) : null}
        </span>
      </div>
      {searchable && options.length > 10 ? (
        <input
          type="search"
          className="input checkbox-group__filter"
          placeholder={`Filter ${options.length} options…`}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      ) : null}
      <div className="checkbox-group__items" role="group" aria-label={title}>
        {filtered.map((option) => (
          <label className="checkbox-group__item" key={option.value}>
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={(event) => toggle(option.value, event.target.checked)}
            />
            <span>{option.label}</span>
          </label>
        ))}
        {searchable && filtered.length === 0 ? (
          <span className="text-faint u-meta-xs">
            No options match "{filter}"
          </span>
        ) : null}
      </div>
    </div>
  );
}
