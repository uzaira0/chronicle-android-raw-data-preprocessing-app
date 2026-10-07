import { describe, expect, it } from "vitest";

import bridgeJson from "../../schema/sleep-diary-catalog.bridge.json" with { type: "json" };
import {
  type SleepDiaryBridgeProfile,
  computeSleepDiaryBridgePayloadSha256,
  createSleepDiaryMethodProfileReceipt,
  executeSleepDiaryFixture,
  normalizeSleepDiaryProfile,
  sanitizeDiaryReplicationBinding,
  verifySleepDiaryBridgeAuthority,
} from "@/lib/sleepDiaryReplication";

/**
 * The fail-closed rules of `src/lib/sleepDiaryReplication.ts`. The bridge it
 * adjudicates is the generated `web/schema/sleep-diary-catalog.bridge.json`,
 * pinned by the hardcoded payload digest and the three expected profile
 * identities in that module; the adapter rules below are the ones each
 * registered `execution_adapter_id` enforces over a profile's own mapping
 * profile and conformance fixture.
 */
type Json = Record<string, unknown>;

const bridge = bridgeJson as unknown as Json & {
  supportedProfiles: Json[];
  variants: Json[];
};
const supportedProfiles = bridge.supportedProfiles as unknown as SleepDiaryBridgeProfile[];

function bridgeClone() {
  return structuredClone(bridge);
}

const UNSUPPORTED = "The generated Sleep Scoring diary bridge is unsupported or incomplete.";

describe("sleep diary bridge authority", () => {
  it("accepts the generated bridge as shipped", async () => {
    await expect(verifySleepDiaryBridgeAuthority()).resolves.toBeUndefined();
  });

  it.each([
    ["a bridge that is not an object", "not-a-bridge"],
    ["an array in place of a bridge", []],
    ["null in place of a bridge", null],
  ])("refuses %s", async (_label, candidate) => {
    await expect(verifySleepDiaryBridgeAuthority(candidate)).rejects.toThrow(UNSUPPORTED);
  });

  it.each([
    ["a schema version the reader does not implement", (draft: ReturnType<typeof bridgeClone>) => {
      draft.schemaVersion = "chronicle-sleep-diary-catalog-bridge-v1";
    }],
    ["a payload digest other than the pinned one", (draft: ReturnType<typeof bridgeClone>) => {
      draft.bridgePayloadSha256 = "0".repeat(64);
    }],
    ["a catalog source digest that is not a sha256", (draft: ReturnType<typeof bridgeClone>) => {
      (draft.authority as Json).catalogSourceSha256 = "not-a-digest";
    }],
    ["a variant count other than 82", (draft: ReturnType<typeof bridgeClone>) => {
      draft.variants = draft.variants.slice(1);
    }],
    ["a variant that is not blocked", (draft: ReturnType<typeof bridgeClone>) => {
      draft.variants[0]!.profileExecutionStatus = "executable";
    }],
    ["a blocked variant with no blocker code", (draft: ReturnType<typeof bridgeClone>) => {
      draft.variants[0]!.blockerCodes = [];
    }],
    ["a supported-profile count other than the three expected identities", (draft) => {
      draft.supportedProfiles = draft.supportedProfiles.slice(1);
    }],
    ["a supported profile whose layout is not fixture-verified", (draft) => {
      draft.supportedProfiles[0]!.layoutExecutionStatus = "unverified";
    }],
    ["a supported profile whose mapping profile was renamed", (draft) => {
      (draft.supportedProfiles[0]!.mappingProfile as Json).mapping_profile_id = "renamed";
    }],
    ["a supported profile whose fixture input digest moved", (draft) => {
      (draft.supportedProfiles[0]!.conformanceFixture as Json).input_sha256 = "0".repeat(64);
    }],
    ["a supported profile whose diary item count moved", (draft) => {
      draft.supportedProfiles[0]!.diaryItems = [];
    }],
    ["a supported profile whose variant no longer releases its source layout", (draft) => {
      const target = draft.supportedProfiles[0]!;
      const variant = draft.variants.find(
        (row) => row.versionDefinitionId === target.versionDefinitionId,
      )!;
      variant.releasedSourceLayoutIds = [];
    }],
  ] as Array<[string, (draft: ReturnType<typeof bridgeClone>) => void]>)(
    "refuses %s",
    async (_label, tamper) => {
      const draft = bridgeClone();
      tamper(draft);
      await expect(verifySleepDiaryBridgeAuthority(draft)).rejects.toThrow(UNSUPPORTED);
    },
  );

  it("refuses a bridge whose payload changed under an unchecked field", async () => {
    // Every identity rule still passes, so only the recomputed payload digest
    // can catch this one.
    const draft = bridgeClone();
    draft.variants[0]!.label = `${String(draft.variants[0]!.label)} (relabelled)`;
    await expect(verifySleepDiaryBridgeAuthority(draft)).rejects.toThrow(
      "The generated Sleep Scoring diary bridge payload digest is invalid.",
    );
  });

  it.each([
    ["a string", "payload"],
    ["an array", []],
    ["null", null],
  ])("refuses to digest %s as a bridge payload", async (_label, candidate) => {
    await expect(computeSleepDiaryBridgePayloadSha256(candidate)).rejects.toThrow(
      "Sleep diary bridge payload must be an object.",
    );
  });
});

describe("registered source layout selection", () => {
  it.each([
    ["an unknown version definition", "version-absent", "sleepdiaries-v1-csv"],
    ["a mapping profile the version does not carry", "version-zenodo-minap-v1.0", "sleepdiaries-v1-csv"],
  ])("refuses to execute %s", async (_label, versionDefinitionId, mappingProfileId) => {
    await expect(
      executeSleepDiaryFixture(versionDefinitionId, mappingProfileId),
    ).rejects.toThrow("The selected sleep diary source layout is not registered.");
  });

  it("refuses to build a receipt for an unregistered layout", async () => {
    await expect(
      createSleepDiaryMethodProfileReceipt("version-absent", "sleepdiaries-v1-csv"),
    ).rejects.toThrow("The selected sleep diary source layout is not registered.");
  });
});

describe("source layout adapters", () => {
  const profileFor = (adapterId: string): SleepDiaryBridgeProfile =>
    structuredClone(
      supportedProfiles.find(
        (profile) => profile.mappingProfile.execution_adapter_id === adapterId,
      )!,
    );

  it("normalizes each registered adapter's own fixture to its expected digest input", () => {
    for (const profile of supportedProfiles) {
      const normalized = normalizeSleepDiaryProfile(structuredClone(profile));
      expect(normalized.split("\n")[0]).toBe(
        profile.conformanceFixture.expected_output_headers.join(","),
      );
    }
  });

  it("refuses an adapter id the module does not implement", () => {
    const profile = profileFor("direct-tabular-csv-v1");
    profile.mappingProfile.execution_adapter_id = "unregistered-adapter-v9";
    expect(() => normalizeSleepDiaryProfile(profile)).toThrow(
      "The selected sleep diary source adapter is unsupported.",
    );
  });

  describe("direct tabular CSV", () => {
    const csv = () => profileFor("direct-tabular-csv-v1");

    it("refuses selector positions that are not contiguous from one", () => {
      const profile = csv();
      profile.mappingProfile.source_field_selectors[0]!.source_field_position = 2;
      expect(() => normalizeSleepDiaryProfile(profile)).toThrow(
        "Sleep diary selector positions are not contiguous.",
      );
    });

    it("refuses a fixture header that disagrees with the ordered schema", () => {
      const profile = csv();
      profile.conformanceFixture.input_text =
        `renamed_first_column${profile.conformanceFixture.input_text.slice(
          profile.conformanceFixture.input_text.indexOf(","),
        )}`;
      expect(() => normalizeSleepDiaryProfile(profile)).toThrow(
        "Sleep diary CSV fixture header disagrees with the reviewed ordered schema.",
      );
    });

    it("refuses a record with a different field count from the header", () => {
      const profile = csv();
      const [header] = profile.conformanceFixture.input_text.trimEnd().split("\n");
      profile.conformanceFixture.input_text = `${header!}\ntruncated\n`;
      expect(() => normalizeSleepDiaryProfile(profile)).toThrow(
        "Sleep diary CSV fixture record shape disagrees with its reviewed contract.",
      );
    });
  });

  describe("keyed object JSON", () => {
    const json = () => profileFor("keyed-object-json-v1");

    it("refuses a record root other than the reviewed entries array", () => {
      const profile = json();
      profile.mappingProfile.record_assembly = { record_root_path: "$.rows[*]" };
      expect(() => normalizeSleepDiaryProfile(profile)).toThrow(
        "The keyed-object diary root is not the reviewed entries array.",
      );
    });

    it.each([
      ["a fixture that is not an object", "[]", "The keyed-object diary fixture is not an object."],
      [
        "a fixture with no entries array",
        '{"rows":[]}',
        "The keyed-object diary fixture has no entries array.",
      ],
      [
        "an entries array holding a non-object",
        '{"entries":["row"]}',
        "The keyed-object diary entries array contains a non-object.",
      ],
      [
        "an answers member that is not an object",
        '{"entries":[{"answers":"flat"}]}',
        "The keyed-object diary answers member is not an object.",
      ],
    ])("refuses %s", (_label, inputText, message) => {
      const profile = json();
      profile.conformanceFixture.input_text = inputText;
      expect(() => normalizeSleepDiaryProfile(profile)).toThrow(message);
    });

    it("refuses output positions that are not contiguous from one", () => {
      const profile = json();
      profile.mappingProfile.execution_output_selectors![0]!.source_field_position = 3;
      expect(() => normalizeSleepDiaryProfile(profile)).toThrow(
        "The keyed-object diary output positions are not contiguous.",
      );
    });

    it("refuses an output selector that renames its source selector", () => {
      const profile = json();
      profile.mappingProfile.execution_output_selectors![0]!.source_field_name = "renamed";
      expect(() => normalizeSleepDiaryProfile(profile)).toThrow(
        "The keyed-object diary source and output selectors disagree.",
      );
    });

    it("refuses a source selector whose path is not the registered one", () => {
      const profile = json();
      profile.mappingProfile.source_field_selectors[0]!.source_path = "$.elsewhere";
      expect(() => normalizeSleepDiaryProfile(profile)).toThrow(
        "The keyed-object diary selector path is not registered.",
      );
    });

    it("refuses source and output selector vectors of different lengths", () => {
      const profile = json();
      const selectors = profile.mappingProfile.source_field_selectors;
      profile.mappingProfile.source_field_selectors = [
        ...selectors,
        { ...selectors[selectors.length - 1]!, selector_id: "extra" },
      ];
      expect(() => normalizeSleepDiaryProfile(profile)).toThrow(
        "The keyed-object diary selector vectors disagree.",
      );
    });

    it("refuses a selector that resolves to a non-scalar value", () => {
      const profile = json();
      const first = profile.mappingProfile.source_field_selectors[0]!;
      const entry = first.source_part_id === "answers"
        ? { answers: { [first.source_field_name]: {} } }
        : { [first.source_field_name]: {} };
      profile.conformanceFixture.input_text = JSON.stringify({ entries: [entry] });
      expect(() => normalizeSleepDiaryProfile(profile)).toThrow(
        "The keyed-object diary selector resolved to a non-scalar value.",
      );
    });

    it("emits an empty field for an entry that omits a selector", () => {
      const profile = json();
      profile.conformanceFixture.input_text = JSON.stringify({ entries: [{}] });
      const rows = normalizeSleepDiaryProfile(profile).trimEnd().split("\n");
      expect(rows).toHaveLength(2);
      expect(rows[1]).toBe(
        profile.mappingProfile.source_field_selectors.map(() => "").join(","),
      );
    });
  });

  describe("chronological event pairing", () => {
    const events = () => profileFor("chronological-event-pairing-v1");

    it("refuses assembly parameters other than the reviewed SLEEP/WAKE pair", () => {
      const profile = events();
      profile.mappingProfile.record_assembly = {
        parameter_json: '{"sleep_event_type":"BED","wake_event_type":"WAKE"}',
      };
      expect(() => normalizeSleepDiaryProfile(profile)).toThrow(
        "chronological-event-pairing-v1 requires the reviewed SLEEP/WAKE parameters.",
      );
    });

    it("refuses an event type outside SLEEP and WAKE", () => {
      const profile = events();
      profile.conformanceFixture.input_text = profile.conformanceFixture.input_text.replace(
        "SLEEP",
        "NAP",
      );
      expect(() => normalizeSleepDiaryProfile(profile)).toThrow(
        "Event type must be SLEEP or WAKE.",
      );
    });

    it("refuses an event epoch that is not a safe integer", () => {
      const profile = events();
      const [header, first, ...rest] = profile.conformanceFixture.input_text
        .trimEnd()
        .split("\n");
      const columns = header!.split(",");
      const epochIndex = columns.indexOf("event_epoch_ms");
      const fields = first!.split(",");
      fields[epochIndex] = "not-an-epoch";
      profile.conformanceFixture.input_text = [header, fields.join(","), ...rest].join("\n");
      expect(() => normalizeSleepDiaryProfile(profile)).toThrow(
        "Event epoch must be a safe integer number of milliseconds.",
      );
    });

    it("refuses declared output selectors that are not the emitted header vector", () => {
      const profile = events();
      profile.mappingProfile.execution_output_selectors =
        profile.mappingProfile.execution_output_selectors!.slice(1);
      expect(() => normalizeSleepDiaryProfile(profile)).toThrow(
        "The declared pairing output selectors do not match the exact emitted header vector.",
      );
    });

    it("pairs a WAKE with no preceding SLEEP and leaves its duration empty", () => {
      const profile = events();
      const [header, ...records] = profile.conformanceFixture.input_text.trimEnd().split("\n");
      const columns = header!.split(",");
      const typeIndex = columns.indexOf("event_type");
      const wakeOnly = records.filter((row) => row.split(",")[typeIndex] === "WAKE").slice(0, 1);
      expect(wakeOnly).toHaveLength(1);
      profile.conformanceFixture.input_text = [header, ...wakeOnly].join("\n");
      const rows = normalizeSleepDiaryProfile(profile).trimEnd().split("\n");
      expect(rows).toHaveLength(2);
      expect(rows[1]!.endsWith(",")).toBe(true);
    });
  });
});

describe("diary replication binding sanitization", () => {
  it.each([
    ["a value that is not an object", "binding"],
    ["an array", []],
    ["null", null],
  ])("drops %s", (_label, candidate) => {
    expect(sanitizeDiaryReplicationBinding(candidate)).toBeUndefined();
  });

  it("drops a binding whose identity fields are not strings", async () => {
    const receipt = await createSleepDiaryMethodProfileReceipt();
    expect(
      sanitizeDiaryReplicationBinding({
        ...receipt.diaryReplicationBinding,
        versionDefinitionId: 1,
      }),
    ).toBeUndefined();
    expect(
      sanitizeDiaryReplicationBinding({
        ...receipt.diaryReplicationBinding,
        mappingProfileId: 1,
      }),
    ).toBeUndefined();
  });

  it("drops a binding naming a layout the bridge does not register", async () => {
    const receipt = await createSleepDiaryMethodProfileReceipt();
    expect(
      sanitizeDiaryReplicationBinding({
        ...receipt.diaryReplicationBinding,
        versionDefinitionId: "version-absent",
      }),
    ).toBeUndefined();
  });
});
