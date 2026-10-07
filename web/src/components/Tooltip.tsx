import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ReactElement } from "react";

import { createPortal } from "react-dom";

export type TooltipContent = {
  title?: string;
  body?: ReactNode;
  example?: string;
};

type TooltipProps = {
  content?: TooltipContent;
  label?: string;
};

const POPOVER_OFFSET = 8;
/**
 * Grace period before a hover-opened popover closes, long enough to cross the
 * POPOVER_OFFSET gap from the trigger onto the popover (WCAG 1.4.13: content
 * shown on hover must stay while the pointer moves over it).
 */
const HOVER_CLOSE_DELAY_MS = 200;
const POPOVER_GAP = 12;

type Anchor = { top: number; left: number };

function computeAnchor(target: HTMLElement, popover: HTMLElement): Anchor {
  const rect = target.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  let top = rect.bottom + POPOVER_OFFSET;
  let left = rect.left + rect.width / 2 - popoverRect.width / 2;
  if (left + popoverRect.width > window.innerWidth - POPOVER_GAP) {
    left = window.innerWidth - popoverRect.width - POPOVER_GAP;
  }
  if (left < POPOVER_GAP) {
    left = POPOVER_GAP;
  }
  if (top + popoverRect.height > window.innerHeight - POPOVER_GAP) {
    top = rect.top - popoverRect.height - POPOVER_OFFSET;
  }
  return { top, left };
}

export function Tooltip({ content, label }: TooltipProps): ReactElement | null {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const popoverId = useId();

  const visible = open || pinned;
  const closeTimerRef = useRef<number | null>(null);
  const cancelHoverClose = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };
  const scheduleHoverClose = () => {
    cancelHoverClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  };
  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

  const applyAnchor = (anchor: Anchor) => {
    const popover = popoverRef.current;
    if (!popover) return;
    popover.style.setProperty("--popover-top", `${anchor.top}px`);
    popover.style.setProperty("--popover-left", `${anchor.left}px`);
  };

  useLayoutEffect(() => {
    if (!visible || !triggerRef.current || !popoverRef.current) {
      return;
    }
    applyAnchor(computeAnchor(triggerRef.current, popoverRef.current));
  }, [visible, content?.title, content?.body, content?.example]);

  useEffect(() => {
    if (!visible) {
      return undefined;
    }
    const handler = (event: MouseEvent) => {
      if (
        triggerRef.current?.contains(event.target as Node) ||
        popoverRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setPinned(false);
      setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPinned(false);
        setOpen(false);
      }
    };
    const reposition = () => {
      if (triggerRef.current && popoverRef.current) {
        applyAnchor(computeAnchor(triggerRef.current, popoverRef.current));
      }
    };
    window.addEventListener("mousedown", handler);
    window.addEventListener("keydown", escape);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("mousedown", handler);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [visible]);

  if (!content || (!content.title && !content.body && !content.example)) {
    return null;
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className={`tooltip-trigger${pinned ? " is-pinned" : ""}`}
        aria-label={label ?? content.title ?? "Help"}
        aria-describedby={visible ? popoverId : undefined}
        aria-expanded={visible}
        onMouseEnter={() => {
          cancelHoverClose();
          setOpen(true);
        }}
        onMouseLeave={scheduleHoverClose}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(event) => {
          event.preventDefault();
          setPinned((current) => !current);
        }}
      >
        ?
      </button>
      {visible
        ? createPortal(
            <div
              id={popoverId}
              role="tooltip"
              ref={popoverRef}
              className="popover"
              onMouseEnter={cancelHoverClose}
              onMouseLeave={scheduleHoverClose}
            >
              {content.title ? <p className="popover__title">{content.title}</p> : null}
              {content.body ? <p className="popover__body">{content.body}</p> : null}
              {content.example ? <div className="popover__example">{content.example}</div> : null}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
