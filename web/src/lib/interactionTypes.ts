/**
 * Raw Android usage-event interaction-type strings → canonical names.
 *
 * Mirrored with the Python oracle (`ALL_INTERACTION_TYPES_MAP` in
 * `constants.py`). Kept in a standalone, dependency-free module so lightweight
 * consumers (e.g. pre-flight file inspection) can reuse the recognized set
 * without importing the full processing pipeline.
 */
export const ALL_INTERACTION_TYPES_MAP: Record<string, string> = {
  "Instance of Usage for an App": "App Usage",
  "Screen Usage": "Screen Usage",
  "Activity Resumed for a Filtered App": "Filtered App Resumed",
  "Activity Paused for a Filtered App": "Filtered App Paused",
  "Instance of Usage for a Filtered App": "Filtered App Usage",
  "Missing End of Usage after an App Starts Being Used": "End of Usage Missing",
  "Unknown importance: 1": "Activity Resumed",
  "Unknown importance: 2": "Activity Paused",
  "Unknown importance: 3": "End of Day",
  "Unknown importance: 4": "Continue Previous Day",
  "Unknown importance: 5": "Configuration Change",
  "Unknown importance: 6": "System Interaction",
  "Unknown importance: 7": "User Interaction",
  "Unknown importance: 8": "Shortcut Invocation",
  "Unknown importance: 9": "Chooser Action",
  "Unknown importance: 10": "Notification Seen",
  "Unknown importance: 11": "Standby Bucket Changed",
  "Unknown importance: 12": "Notification Interruption",
  "Unknown importance: 13": "Slice Pinned Priv",
  "Unknown importance: 14": "Slice Pinned App",
  "Unknown importance: 15": "Screen Interactive",
  "Unknown importance: 16": "Screen Non-Interactive",
  "Unknown importance: 17": "Keyguard Shown",
  "Unknown importance: 18": "Keyguard Hidden",
  "Unknown importance: 19": "Foreground Service Start",
  "Unknown importance: 20": "Foreground Service Stop",
  "Unknown importance: 21": "Continuing Foreground Service",
  "Unknown importance: 22": "Rollover Foreground Service",
  "Unknown importance: 23": "Activity Stopped",
  "Unknown importance: 24": "Activity Destroyed",
  "Unknown importance: 25": "Flush to Disk",
  "Unknown importance: 26": "Device Shutdown",
  "Unknown importance: 27": "Device Startup",
  "Unknown importance: 28": "User Unlocked",
  "Unknown importance: 29": "User Stopped",
  "Unknown importance: 30": "Locus ID Set",
  "Unknown importance: 31": "App Component Used",
  "Move to Foreground": "Activity Resumed",
  "Move to Background": "Activity Paused",
};

/** Separator used to encode a `"Raw value => Canonical name"` remap entry (#4). */
export const INTERACTION_REMAP_DELIMITER = "=>";

/**
 * Canonical interaction-type names the pipeline understands — the distinct
 * values of {@link ALL_INTERACTION_TYPES_MAP}. These are the valid targets for
 * the custom interaction-type remap UI (#4).
 */
export const CANONICAL_INTERACTION_TYPES: readonly string[] = Array.from(
  new Set(Object.values(ALL_INTERACTION_TYPES_MAP)),
).sort((left, right) => left.localeCompare(right));

/**
 * Parse user-supplied custom interaction-type remap entries (each
 * `"Raw value => Canonical name"`) into a lookup. Entries lacking the delimiter
 * or with an empty side are skipped; later entries win on key collision. Kept
 * here (dependency-free) so the pre-flight inspector can reuse it without
 * importing the full processing pipeline.
 */
export function parseInteractionRemap(entries: readonly string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of entries) {
    const splitAt = entry.indexOf(INTERACTION_REMAP_DELIMITER);
    if (splitAt === -1) continue;
    const from = entry.slice(0, splitAt).trim();
    const to = entry.slice(splitAt + INTERACTION_REMAP_DELIMITER.length).trim();
    if (!from || !to) continue;
    map.set(from, to);
  }
  return map;
}
