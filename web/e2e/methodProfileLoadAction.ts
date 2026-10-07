import { expect, type Locator } from "@playwright/test";

import { DEFAULT_BROWSER_OPTIONS } from "../src/lib/generatedContract";
import {
  compileNativeMethodProfile,
  selectMethodConfiguration,
  type MethodProfileCompilation,
  type StudyMethodProfile,
} from "../src/lib/methodProfiles";

/**
 * Assert the research-method-profile card offers the load action that
 * compileNativeMethodProfile decides for the selected profile, exactly as
 * ResearchMethodProfileCard renders it:
 *
 * - a fully reproduced compilation: "Load selected settings", enabled;
 * - an incomplete compilation with a supported plan (at least one setting bound
 *   to a native option, registered input adapter, output or external
 *   executor): "Load supported preprocessing settings", enabled;
 * - otherwise "Load supported preprocessing settings", disabled.
 *
 * Which of the three a canonical literature profile reaches is not fixed: it
 * moves whenever the private adjudicated library or the registered component
 * set changes (registering input adapters in 7c2477cf gave Finesse, MultiDevice
 * and many others a supported plan, and made Böhmer fully reproduced). Imported
 * supplied records never enter the compilation, so they cannot change the
 * answer. The card compiles against the current settings, which are the
 * defaults in every caller.
 */
export async function expectMethodProfileLoadAction(
  card: Locator,
  profile: StudyMethodProfile,
  selectedLevels: Record<string, string> = {},
): Promise<MethodProfileCompilation> {
  const selection = selectMethodConfiguration(profile, selectedLevels);
  const compiled = compileNativeMethodProfile(
    profile,
    DEFAULT_BROWSER_OPTIONS,
    selection.ok ? selection.selection : undefined,
  );
  const loadSelected = card.getByRole("button", { name: "Load selected settings" });
  const loadSupported = card.getByRole("button", { name: "Load supported preprocessing settings" });
  if (compiled.ok) {
    await expect(loadSelected).toBeEnabled();
    await expect(loadSupported).toHaveCount(0);
  } else {
    await expect(loadSelected).toHaveCount(0);
    if (compiled.supportedPlan) await expect(loadSupported).toBeEnabled();
    else await expect(loadSupported).toBeDisabled();
  }
  return compiled;
}
