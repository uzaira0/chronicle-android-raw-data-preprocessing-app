import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import {
  describeOpenBindingHoles,
  executeRustRuntime,
  openBindingHolesMessage,
  parseOpenBindingHoleRoles,
  setRustRuntimeForTesting,
} from "@/lib/rustPipelineRuntime";
import * as runtimeWasm from "@/wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm.js";

beforeAll(async () => {
  runtimeWasm.initSync({
    module: await readFile(
      new URL(
        "../wasm/chronicle_preprocessing_runtime_wasm/pkg/chronicle_preprocessing_runtime_wasm_bg.wasm",
        import.meta.url,
      ),
    ),
  });
  setRustRuntimeForTesting(
    runtimeWasm,
  );
});

/**
 * A support file whose schema Rust rejects used to reach the user as
 * "unresolved binding holes for required roles: filter_file; evaluate
 * requirements before execution" — the same sentence a *missing* file
 * produces. The column-level reason
 * (`validate_support_csv`'s "{role}: requires one of columns ...") is computed
 * during qualification, stored as the `content_validation_error` qualifier on
 * the role assignment, and then read only through its boolean sibling, so it
 * never reached the failure. `evaluate_workspace_requirements`, the function
 * the message told the user to run, was exported from the WASM package and
 * declared nowhere in the TypeScript kernel surface.
 */

const RAW_CSV = new TextEncoder().encode(
  [
    "study_id,participant_id,username,application_label,interaction_type,app_package_name,event_timestamp,timezone",
    "S1,P01,Target Child,Example,Activity Resumed,com.example.app,2026-03-08 10:00:00,America/Chicago",
    "S1,P01,Target Child,Example,Activity Paused,com.example.app,2026-03-08 10:01:00,America/Chicago",
  ].join("\n"),
);

function options() {
  return {
    ...DEFAULT_BROWSER_OPTIONS,
    studyName: "Support schema refusal",
    selectedTimezone: "America/Chicago",
    timezoneHandling: "selected-convert" as const,
    useFilterFile: true,
    useAppsForcingScreenOpenFile: false,
    useBackgroundAppsFile: false,
    useAppCodebook: false,
    processScreenUsage: false,
    enablePlotting: false,
    enableInteractiveTimeline: false,
  };
}

const RUNTIME = {
  datetimeOfPreprocessing: "2026-08-27 00:00:00 UTC",
  persistRustWorkspace: false,
  incrementalEngine: true,
  provenanceEvidence: true,
};

describe("support-file schema failure reaches the user with the column", () => {
  it("names the column the filter file is missing, not only the role", async () => {
    // `filter_file` needs app_package_name or package_name; this has neither.
    const filterFile = {
      name: "apps_to_filter.csv",
      bytes: new TextEncoder().encode("participant_id,value\nP01,unrelated\n")
        .buffer,
    };
    const failure = await executeRustRuntime(
      RAW_CSV,
      "support-schema.csv",
      options(),
      { filterFile },
      RUNTIME,
    ).then(
      () => null,
      (error: unknown) =>
        error instanceof Error ? error.message : String(error),
    );
    expect(failure, "a wrong-schema filter file must not process").not.toBeNull();
    // The actionable part: which role, and which column it needs.
    expect(failure).toContain("filter_file");
    expect(failure).toContain("app_package_name");
    expect(failure).toContain("package_name");
    // The runtime's own refusal is preserved for support/debugging.
    expect(failure).toContain("unresolved binding holes for required roles");
  });

  it("names the column on the default screen-usage path too (scientific preflight)", async () => {
    // Screen usage is on by default, and its preflight meets the unbound role
    // before execution does; it used to surface the bare refusal there.
    const failure = await executeRustRuntime(
      RAW_CSV,
      "support-schema-screen.csv",
      { ...options(), processScreenUsage: true },
      {
        filterFile: {
          name: "apps_to_filter.csv",
          bytes: new TextEncoder().encode("participant_id,value\nP01,unrelated\n").buffer,
        },
      },
      { ...RUNTIME, incrementalEngine: false },
    ).then(
      () => null,
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(failure).toContain("Support file requirements are not met");
    expect(failure).toContain("app_package_name");
  });

  it("a correctly-shaped filter file still processes", async () => {
    const execution = await executeRustRuntime(
      RAW_CSV,
      "support-schema-ok.csv",
      options(),
      {
        filterFile: {
          name: "apps_to_filter.csv",
          bytes: new TextEncoder().encode("app_package_name\ncom.other.app\n")
            .buffer,
        },
      },
      RUNTIME,
    );
    expect(execution.manifest.workspaceRootDigest).toMatch(/^blake3:|^sha256:/);
  });
});

describe("open-binding-hole message construction", () => {
  it("reads the role list out of the runtime's refusal", () => {
    expect(
      parseOpenBindingHoleRoles(
        "unresolved binding holes for required roles: filter_file, study_dates_file; evaluate requirements before execution",
      ),
    ).toEqual(["filter_file", "study_dates_file"]);
    expect(parseOpenBindingHoleRoles("some other runtime failure")).toEqual([]);
  });

  it("prefers the content-validation reason Rust computed", () => {
    const report = JSON.stringify({
      roleAssignments: [
        {
          role_id: "filter_file",
          qualifiers: {
            content_validation: "failed",
            content_validation_error:
              "filter_file: requires one of columns app_package_name, package_name",
          },
        },
      ],
      roleStates: { filter_file: "invalid" },
    });
    expect(describeOpenBindingHoles(report, ["filter_file"])).toBe(
      "filter_file: requires one of columns app_package_name, package_name",
    );
  });

  it("distinguishes an absent file from a rejected one", () => {
    const absent = JSON.stringify({
      roleAssignments: [],
      roleStates: { study_dates_file: "open" },
    });
    expect(describeOpenBindingHoles(absent, ["study_dates_file"])).toBe(
      "study_dates_file: no file is bound to this required role",
    );
    const rejected = JSON.stringify({
      roleAssignments: [],
      roleStates: { study_dates_file: "invalid" },
    });
    expect(describeOpenBindingHoles(rejected, ["study_dates_file"])).toBe(
      "study_dates_file: the supplied file was rejected",
    );
  });

  /**
   * G1. `MaterializationState` has six variants. The re-query is a SEPARATE
   * ingress materialization from the execution that just failed, so the two can
   * disagree; describing any state other than the two that genuinely mean
   * "unbound" or "rejected" would replace the kernel's real refusal with a
   * fabricated "no file is bound" while a file IS bound.
   */
  it.each(["ready", "satisfied", "blocked", "not_applicable"])(
    "abandons the enrichment when the re-query reports %s",
    (state) => {
      expect(
        describeOpenBindingHoles(
          JSON.stringify({
            roleAssignments: [],
            roleStates: { filter_file: state },
          }),
          ["filter_file"],
        ),
      ).toBeNull();
    },
  );

  it("abandons the enrichment when the report omits the role entirely", () => {
    expect(
      describeOpenBindingHoles(
        JSON.stringify({ roleAssignments: [], roleStates: {} }),
        ["filter_file"],
      ),
    ).toBeNull();
  });

  it("abandons the whole detail when ONE of several roles is undescribable", () => {
    // Partial detail would be worse than none: it would name one role and
    // silently drop the other from a message that replaces the kernel's.
    expect(
      describeOpenBindingHoles(
        JSON.stringify({
          roleAssignments: [],
          roleStates: { filter_file: "open", study_dates_file: "satisfied" },
        }),
        ["filter_file", "study_dates_file"],
      ),
    ).toBeNull();
  });

  it("returns null on an unusable report rather than inventing a reason", () => {
    expect(describeOpenBindingHoles("not json", ["filter_file"])).toBeNull();
    // Non-vacuous: a role IS requested and the empty report describes none of
    // it, so the original refusal must stand.
    expect(describeOpenBindingHoles("{}", ["filter_file"])).toBeNull();
  });

  it("keeps the runtime's own words inside the rewritten message", () => {
    const original =
      "unresolved binding holes for required roles: filter_file; evaluate requirements before execution";
    const message = openBindingHolesMessage(original, "filter_file: bad");
    expect(message).toContain("filter_file: bad");
    expect(message).toContain(original);
  });
});
