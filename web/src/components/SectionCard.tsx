import { useEffect, useState, type ReactNode } from "react";
import type { ReactElement } from "react";


type SectionAccent =
  | "files"
  | "timezone"
  | "session"
  | "screen"
  | "interaction"
  | "performance";

type SectionCardProps = {
  id: string;
  title: string;
  accent: SectionAccent;
  defaultExpanded?: boolean;
  modified?: boolean;
  children: ReactNode;
  trailingHeader?: ReactNode;
};

const STORAGE_PREFIX = "chronicle.cards.";

function readPersistedExpanded(id: string, fallback: boolean): boolean {
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const value = window.localStorage.getItem(STORAGE_PREFIX + id);
    if (value === "1") return true;
    if (value === "0") return false;
  } catch {
    // localStorage may be unavailable (private mode); fall back silently.
  }
  return fallback;
}

function writePersistedExpanded(id: string, expanded: boolean): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, expanded ? "1" : "0");
  } catch {
    // Ignore storage failures.
  }
}

export function SectionCard({
  id,
  title,
  accent,
  defaultExpanded = true,
  modified = false,
  children,
  trailingHeader,
}: SectionCardProps): ReactElement {
  const [expanded, setExpanded] = useState<boolean>(() =>
    readPersistedExpanded(id, defaultExpanded),
  );

  useEffect(() => {
    writePersistedExpanded(id, expanded);
  }, [id, expanded]);

  const stateClass = expanded ? "is-expanded" : "is-collapsed";

  return (
    <section className={`section-card accent-${accent} ${stateClass}`} data-section-id={id}>
      <button
        type="button"
        className="section-card__header"
        aria-expanded={expanded}
        aria-controls={`${id}-body`}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="section-card__title">{title}</span>
        <span className={`section-card__badge ${modified ? "is-modified" : "is-default"}`}>
          {modified ? (
            <>
              <span className="dot" aria-hidden="true" />
              Modified
            </>
          ) : (
            "Default"
          )}
        </span>
        {trailingHeader}
        <span className="section-card__chevron" aria-hidden="true">
          <svg width="12" height="8" viewBox="0 0 12 8" fill="none">
            <path
              d="M1 1.5L6 6.5L11 1.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      <div id={`${id}-body`} className="section-card__body">
        {children}
      </div>
    </section>
  );
}
