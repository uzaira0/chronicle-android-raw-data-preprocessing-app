import { useId } from "react";
import type { ReactElement } from "react";

import { Tooltip, type TooltipContent } from "@/components/Tooltip";

type ToggleFieldProps = {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  testId?: string;
  tooltip?: TooltipContent;
  modified?: boolean;
  onReset?: () => void;
  disabled?: boolean;
};

export function ToggleField({
  label,
  checked,
  onChange,
  testId,
  tooltip,
  modified = false,
  onReset,
  disabled = false,
}: ToggleFieldProps): ReactElement {
  const id = useId();
  return (
    <div className="toggle-field">
      <input
        id={id}
        data-testid={testId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <div className="toggle-field__label-block">
        <label htmlFor={id} className="settings-field__label u-cursor-pointer">
          {label}
        </label>
        <Tooltip content={tooltip} label={`Help: ${label}`} />
      </div>
      <span className={`settings-field__indicator${modified ? " is-modified" : ""}`}>
        {modified ? <span aria-hidden="true">●</span> : null}
        {modified && onReset ? (
          <button
            type="button"
            className="settings-field__reset"
            aria-label={`Reset ${label} to default`}
            onClick={onReset}
          >
            ×
          </button>
        ) : null}
      </span>
    </div>
  );
}
