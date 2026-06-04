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
