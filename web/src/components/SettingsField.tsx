import type { ReactNode } from "react";
import type { ReactElement } from "react";

import { Tooltip, type TooltipContent } from "@/components/Tooltip";

type SettingsFieldProps = {
  label: string;
  htmlFor?: string;
  tooltip?: TooltipContent;
  hint?: ReactNode;
  modified?: boolean;
  onReset?: () => void;
  children: ReactNode;
};

export function SettingsField({
  label,
  htmlFor,
  tooltip,
  hint,
  modified = false,
  onReset,
  children,
}: SettingsFieldProps): ReactElement {
  return (
    <div className="settings-field">
      <div className="settings-field__label-row">
        {htmlFor ? (
          <label className="settings-field__label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <span className="settings-field__label">{label}</span>
        )}
        <Tooltip content={tooltip} label={`Help: ${label}`} />
        <span
          className={`settings-field__indicator${modified ? " is-modified" : ""}`}
          aria-hidden={!modified}
        >
          {modified ? (
            <>
              <span aria-hidden="true">●</span>
              Modified
            </>
          ) : null}
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
      <div className="settings-field__control">{children}</div>
      {hint ? <div className="text-faint u-meta-xs">{hint}</div> : null}
    </div>
  );
}
