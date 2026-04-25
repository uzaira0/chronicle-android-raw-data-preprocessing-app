"""Application version information."""

from __future__ import annotations

__version__ = "1.0.0"
__build_date__ = "2026-04-25"

# Version History:
# 1.0.0 (2026-04-25): Browser app production release
# 0.2.0 (2025-12-15): Algorithm configuration improvements
#   - Changed default `allow_stop_event_reuse` to False (prevents artificially short sessions)
#   - Changed default `apply_threshold_to_activity_stopped_fallback` to True (prevents inflated sessions)
#   - Default algorithm changed to 'optimized' (15x faster, identical output)
#   - Added comprehensive documentation for all algorithm settings
#   - Validated against 71 TECH study files with detailed mismatch analysis
# 0.1.5 (2025-11-04): Previous release
