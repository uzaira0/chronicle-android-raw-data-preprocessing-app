import { useEffect, useState } from "react";
import type { ReactElement } from "react";


type Props = {
  value: number[];
  fallback: number[];
  onChange: (next: number[]) => void;
  testId?: string;
  placeholder?: string;
};

function arraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function parse(value: string): number[] {
  return value
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((part) => Number.isFinite(part) && part > 0);
}

/**
 * Comma-separated number list input that keeps an editable string state
 * locally so users can type intermediate values like "1, 2," without the
 * parser eating their cursor. On commit (blur or valid change) it pushes the
 * parsed array up via onChange.
 */
export function ThresholdsInput({ value, fallback, onChange, testId, placeholder }: Props): ReactElement {
  const [text, setText] = useState(() => value.join(", "));

  useEffect(() => {
    const parsed = parse(text);
    if (!arraysEqual(parsed, value)) {
      setText(value.join(", "));
    }
    // Intentional: only re-sync when the upstream value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      data-testid={testId}
      className="input"
      placeholder={placeholder}
      value={text}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        const parsed = parse(next);
        onChange(parsed.length ? parsed : fallback);
      }}
      onBlur={() => setText(value.join(", "))}
    />
  );
}
