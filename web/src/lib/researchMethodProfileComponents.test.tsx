import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { itWithPrivateCorpus } from "@/testSupport/privateCorpusGates";
import { privateCorpusPath } from "@/testSupport/privateCorpus";

import { LiteratureComponentActions, ResearchMethodProfileCard } from "@/components/ResearchMethodProfileCard";
import { DEFAULT_BROWSER_OPTIONS } from "@/lib/generatedContract";
import { compileNativeMethodProfile, parseStudyMethodProfileLibrary, type StudyMethodProfile } from "@/lib/methodProfiles";
import {
  LITERATURE_INPUT_ADAPTER_CONTRACTS,
  literatureComponentExecutionForSettings,
  literatureComponentExecutionsForSettings,
} from "@/lib/literatureInputAdapters";

const cardHarness = vi.hoisted(() => ({ profile: null as StudyMethodProfile | null, stateCalls: 0 }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useState: <S,>(initial: S | (() => S)) => {
      const index = ++cardHarness.stateCalls;
      // Imported profile state only; the real selector and compiler remain in use.
      return react.useState(cardHarness.profile
        ? index === 1 ? [cardHarness.profile] : index === 25 ? cardHarness.profile.method_profile_id : initial
        : initial);
    },
  };
});

function buttonsWithin(node: ReactNode): ReactElement[] {
  const buttons: ReactElement[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === "button") buttons.push(child);
    buttons.push(...buttonsWithin((child.props as { children?: ReactNode }).children));
  });
  return buttons;
}

describe("ResearchMethodProfileCard literature components", () => {
  itWithPrivateCorpus("labels Böhmer's admitted selected calculation without claiming the blocked full profile is ready", () => {
    const library = JSON.parse(readFileSync(privateCorpusPath("ontology-sublation-20260831/adjudicated-method-profile-library.json"), "utf8")) as { profiles: Array<{ source_work_id: string }> };
    const profile = parseStudyMethodProfileLibrary({ profiles: [library.profiles.find((p) => p.source_work_id === "doi:10.1145/2556288.2557066")] }).profiles[0]!;
    expect(profile.profile_implementation_status).toBe("blocked");
    const compiled = compileNativeMethodProfile(profile);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error("the selected twenty-trial calculation must compile");
    expect(compiled.receipt.settingIds).toEqual(["method-setting-d5f9e5c2bbc0fcb4c222ee38"]);
    expect(compiled.receipt.inputBindings).toHaveLength(1);
    const onCompiled = vi.fn();
    const onStatus = vi.fn();
    cardHarness.profile = profile;
    cardHarness.stateCalls = 0;
    let tree: ReactNode;
    const Harness = () => {
      tree = ResearchMethodProfileCard({ options: DEFAULT_BROWSER_OPTIONS, setOptions: vi.fn(), onCompiled, onComponentSelected: vi.fn(), onRunComponent: vi.fn(), onStatus });
      return tree;
    };
    try {
      const html = renderToStaticMarkup(<Harness />);
      expect(html).toContain("Selected settings ready");
      expect(html).toContain("Load selected settings");
      expect(html).toContain("full profile remains blocked");
      expect(html).not.toContain("Full profile ready");
      expect(html).not.toContain("complete profile");
      const load = buttonsWithin(tree).find((b) => renderToStaticMarkup(b).includes("Load selected settings"))!;
      expect(load).toBeDefined();
      (load.props as { onClick: () => void }).onClick();
      expect(onCompiled).toHaveBeenCalledWith(compiled.receipt);
      expect(onStatus).toHaveBeenCalledWith(`Loaded selected settings from ${profile.source_work_id}.`);
    } finally {
      cardHarness.profile = null;
      cardHarness.stateCalls = 0;
    }
  });
  it.each(["chronicle.dekker-post-persistence", "chronicle.anchor-relative-category-window", "chronicle.phonestudy-phone-features", "chronicle.screen-academic-preparation"])("exposes the existing run action for %s with source limitations", (adapterId) => {
    const group = LITERATURE_INPUT_ADAPTER_CONTRACTS.find((entry) => entry.adapterId === adapterId)!;
    const component = literatureComponentExecutionForSettings([...group.methodSettingIds, ...(group.componentExecution?.additionalMethodSettingIds ?? [])])!;
    const onRunComponent = vi.fn();
    const actions = LiteratureComponentActions({ components: [component], componentRunning: false, onComponentSelected: vi.fn(), onRunComponent });
    const html = renderToStaticMarkup(actions);
    expect(html).toContain(component.componentId);
    for (const limitation of component.limitations) expect(html).toContain(renderToStaticMarkup(<>{limitation}</>));
    const buttons = buttonsWithin(actions);
    expect(buttons).toHaveLength(1);
    (buttons[0]!.props as { onClick: () => void }).onClick();
    expect(onRunComponent).toHaveBeenCalledWith(component);
  });

  it("shows and independently runs every registered component owned by one profile", () => {
    const parentMethodProfileId = "method-profile:doi:10.2196/13209";
    const settingIds = LITERATURE_INPUT_ADAPTER_CONTRACTS
      .filter((group) =>
        group.componentExecution?.parentMethodProfileId === parentMethodProfileId)
      .flatMap((group) => group.methodSettingIds);
    const components = literatureComponentExecutionsForSettings(settingIds);
    expect(literatureComponentExecutionForSettings(settingIds)).toBeUndefined();
    expect(components.map((component) => component.componentId)).toEqual([
      "chronicle.bluetooth-address-day-frequency/v1",
      "chronicle.analysis-positive-feature-missingness/v1",
      "chronicle.integer-screen-state-vocabulary/v1",
      "chronicle.movement-speed-state-gate/v1",
      "chronicle.five-minute-step-state-gate/v1",
      "chronicle.loneliness-score-classifier/v1",
    ]);
    expect(components.map((component) => component.requiredSupportRoles)).toEqual([
      [],
      ["analysis_feature_matrix_file"],
      [],
      [],
      [],
      [],
    ]);
    expect(components.every((component) => component.limitations.length > 0)).toBe(true);

    const onComponentSelected = vi.fn();
    const onRunComponent = vi.fn();
    const actions = LiteratureComponentActions({
      components,
      componentRunning: false,
      onComponentSelected,
      onRunComponent,
    });
    const html = renderToStaticMarkup(actions);
    for (const component of components) {
      expect(html).toContain(component.componentId);
      for (const limitation of component.limitations) {
        expect(html).toContain(renderToStaticMarkup(<>{limitation}</>));
      }
    }
    expect(html).toContain("analysis_feature_matrix_file");
    expect(html).toContain("Required support: none");

    const buttons = buttonsWithin(actions);
    expect(buttons).toHaveLength(6);
    for (const [index, button] of buttons.entries()) {
      (button.props as { onClick: () => void }).onClick();
      expect(onComponentSelected).toHaveBeenNthCalledWith(index + 1, components[index]);
      expect(onRunComponent).toHaveBeenNthCalledWith(index + 1, components[index]);
    }
  });
});
