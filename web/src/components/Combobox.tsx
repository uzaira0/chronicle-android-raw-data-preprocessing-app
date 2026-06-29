import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";

type ComboboxProps = {
  value: string;
  onChange: (next: string) => void;
  options: readonly string[];
  placeholder?: string;
  testId?: string;
  className?: string;
  /** ARIA label when the input has no visible <label> (we always pair it). */
  ariaLabel?: string;
  /** Cap on how many filtered options to render at once. Defaults to 100. */
  maxResults?: number;
  /** Select the full input value on focus, useful when the value is the current selection. */
  selectOnFocus?: boolean;
};

/**
 * Accessible combobox that we render ourselves so styling does not depend
 * on the OS-level <datalist> popup. ARIA roles follow the WAI-ARIA 1.2
 * authoring practices for "Combobox with List Autocomplete" so screen
 * readers behave the same as the native widget.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder,
  testId,
  className,
  ariaLabel,
  maxResults = 100,
  selectOnFocus = false,
}: ComboboxProps): ReactElement {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  // True only while the user is actively typing a query. When false, the input
  // is showing a committed selection (or is freshly focused), so the popup lists
  // every option instead of filtering down to the one already chosen — otherwise
  // re-opening the box after a pick hides all the other choices.
  const [isEditing, setIsEditing] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const optionIdPrefix = useId();

  const filtered = useMemo(() => {
    if (!isEditing || !value) return options.slice(0, maxResults);
    const needle = value.toLowerCase();
    const matches: string[] = [];
    for (const option of options) {
      if (option.toLowerCase().includes(needle)) {
        matches.push(option);
        if (matches.length >= maxResults) break;
      }
    }
    return matches;
  }, [isEditing, value, options, maxResults]);

  // Close on outside click / focus loss
  useEffect(() => {
    if (!isOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [isOpen]);

  // Reset highlight when filter changes. When the list shows a committed
  // selection (not a typed query), highlight that option so Enter re-commits it
  // and arrows move from there — rather than always jumping to the first row.
  useEffect(() => {
    if (!filtered.length) {
      setHighlightIndex(-1);
      return;
    }
    const selected = filtered.indexOf(value);
    setHighlightIndex(selected >= 0 ? selected : 0);
  }, [filtered, value]);

  const commit = useCallback(
    (selected: string) => {
      onChange(selected);
      setIsOpen(false);
      setIsEditing(false);
    },
    [onChange],
  );

  const onInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    setIsEditing(true);
    onChange(event.target.value);
    if (!isOpen) setIsOpen(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsOpen(true);
      setHighlightIndex((current) => Math.min(filtered.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIsOpen(true);
      setHighlightIndex((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter") {
      if (isOpen && highlightIndex >= 0 && filtered[highlightIndex]) {
        event.preventDefault();
        commit(filtered[highlightIndex]);
      }
    } else if (event.key === "Escape") {
      if (isOpen) {
        event.preventDefault();
        setIsOpen(false);
      }
    } else if (event.key === "Tab") {
      setIsOpen(false);
    }
  };

  const activeOptionId =
    isOpen && highlightIndex >= 0 ? `${optionIdPrefix}-${highlightIndex}` : undefined;

  return (
    <div className={`combobox${className ? ` ${className}` : ""}`} ref={wrapperRef}>
      <input
        type="text"
        className="input combobox__input"
        data-testid={testId}
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-activedescendant={activeOptionId}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        onChange={onInputChange}
        onFocus={(event) => {
          setIsOpen(true);
          // A fresh focus shows the committed value, not a query — list every
          // option until the user actually types.
          setIsEditing(false);
          if (selectOnFocus) event.currentTarget.select();
        }}
        onClick={() => setIsOpen(true)}
        onKeyDown={onKeyDown}
      />
      {isOpen && filtered.length > 0 ? (
        <ul
          id={listboxId}
          className="combobox__listbox"
          role="listbox"
        >
          {filtered.map((option, index) => (
            <li
              key={option}
              id={`${optionIdPrefix}-${index}`}
              role="option"
              aria-selected={index === highlightIndex}
              className={`combobox__option${
                index === highlightIndex ? " is-highlighted" : ""
              }`}
              onMouseEnter={() => setHighlightIndex(index)}
              onMouseDown={(event) => {
                // Use mousedown so the click commits before the input blurs.
                event.preventDefault();
                commit(option);
              }}
            >
              {option}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
