"""Pure-Python mirror of the Rust split_overlapping_sessions function.

Mirrors rust/chronicle_app_usage_matcher/src/lib.rs::split_overlapping_sessions
exactly so the matcher's Python fallback path produces identical layered rows.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class LayeredRow:
    """One primary/secondary sub-interval row for an input session."""

    session_index: int
    start_ns: int
    stop_ns: int
    layer: str  # "primary" or "secondary"


def split_overlapping_sessions(
    starts: list[int],
    stops: list[int],
) -> list[LayeredRow]:
    """Split possibly-overlapping sessions into primary/secondary sub-intervals.

    In any sub-interval the open session with the greatest start_ns is primary
    (tie broken by greatest input index); every other open session is secondary.
    Adjacent same-session same-layer sub-intervals are coalesced. Output is
    ordered by (session_index, start_ns).
    """
    if len(starts) != len(stops):
        raise ValueError("starts and stops must have the same length")
    for start, stop in zip(starts, stops, strict=True):
        if stop < start:
            raise ValueError("stop must be >= start for every session")

    boundaries = sorted(set(starts) | set(stops))

    raw: list[LayeredRow] = []
    for t0, t1 in zip(boundaries, boundaries[1:], strict=False):
        if t1 <= t0:
            continue
        open_sessions = [i for i in range(len(starts)) if starts[i] <= t0 and stops[i] >= t1]
        if not open_sessions:
            continue
        primary = max(open_sessions, key=lambda i: (starts[i], i))
        for i in open_sessions:
            raw.append(
                LayeredRow(
                    session_index=i,
                    start_ns=t0,
                    stop_ns=t1,
                    layer="primary" if i == primary else "secondary",
                )
            )

    raw.sort(key=lambda r: (r.session_index, r.start_ns))
    out: list[LayeredRow] = []
    for row in raw:
        if (
            out
            and out[-1].session_index == row.session_index
            and out[-1].layer == row.layer
            and out[-1].stop_ns == row.start_ns
        ):
            out[-1] = LayeredRow(
                out[-1].session_index, out[-1].start_ns, row.stop_ns, out[-1].layer
            )
        else:
            out.append(row)

    # Zero-width sessions (start == stop) are covered by no positive sub-interval
    # window, so they produced no row above. Emit a single primary row for each so
    # the session is preserved (matching the non-concurrent path, which keeps a
    # 0-duration row) rather than being silently dropped.
    present = {row.session_index for row in out}
    for i in range(len(starts)):
        if i not in present:
            out.append(LayeredRow(i, starts[i], stops[i], "primary"))
    out.sort(key=lambda r: (r.session_index, r.start_ns))
    return out
