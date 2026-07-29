import type { BrowserSupportFiles } from "@/lib/types";

const SUPPORT_FILE_ROLE_FLAGS = {
  filterFile: true,
  appsForcingScreenOpenFile: true,
  backgroundAppsFile: true,
  appCodebookFile: true,
  studyDatesFile: true,
  deviceSharingFile: true,
  surveyAttributionFile: true,
  enrolledDevicesFile: true,
} as const satisfies Record<keyof BrowserSupportFiles, true>;

/**
 * Every support-file role in one canonical order. The `satisfies
 * Record<..., true>` above makes adding a role to BrowserSupportFiles a
 * compile error here until this list learns about it, so the key derivation
 * and every caller building an ordered input list stay complete.
 */
const SUPPORT_FILE_ROLES = Object.keys(
  SUPPORT_FILE_ROLE_FLAGS,
) as readonly (keyof BrowserSupportFiles)[];

/**
 * The support-file inputs in canonical role order. Callers pass a complete
 * by-role record (a missing role is a compile error), so ordered identity
 * lists built in different places can never drift apart.
 */
export function supportFileInputList<Input>(
  byRole: Record<keyof BrowserSupportFiles, Input>,
): Input[] {
  return SUPPORT_FILE_ROLES.map((role) => byRole[role]);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** Exact key for one immutable support-file bundle crossing a worker boundary. */
export async function comparisonSupportCacheKey(
  supportFiles: BrowserSupportFiles | undefined,
): Promise<string> {
  const entries = await Promise.all(
    SUPPORT_FILE_ROLES.map(async (role) => {
      const file = supportFiles?.[role];
      if (!file) return [role, null] as const;
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", file.bytes),
      );
      return [
        role,
        {
          name: file.name,
          bytes: file.bytes.byteLength,
          sha256: hex(digest),
        },
      ] as const;
    }),
  );
  const encoded = new TextEncoder().encode(JSON.stringify(entries));
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encoded),
  );
  return `sha256:${hex(digest)}`;
}
