import { expect, test } from "@playwright/test";
import { gotoApp, reloadApp } from "./helpers";
import { finesseFeatureSessionExample } from "./fixtures/finesse-feature-session";

test("imports and reloads distinct same-label feature selections with session and selected-owner isolation", async ({ page }) => {
  const input = finesseFeatureSessionExample();
  const other = structuredClone(input);
  other.profiles[0]!.method_profile_id = "example:other-finesse-owner";
  other.app_feature_sessions[0]!.method_profile_id = other.profiles[0]!.method_profile_id;
  other.app_feature_sessions[0]!.session_feature_selections[0]!.selected_feature_occurrence_references = ["first-search"];
  input.profiles.push(...other.profiles);
  input.app_feature_sessions.push(...other.app_feature_sessions);
  await gotoApp(page);
  const picker = page.getByTestId("method-profile-file-input");
  const card = page.locator('[data-settings-anchor="research-method-profile"]');
  const importAll = () => picker.setInputFiles({ name: "feature-session-examples.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(input)) });
  const assertOwner = async (id: string) => {
    await expect(card).toContainText("Same-label occurrences stay distinct; submitted-empty is not unanswered or expired");
    const section = card.locator("details").filter({ has: page.getByText("App feature sessions (1)", { exact: true }) });
    if (!await section.evaluate((el) => (el as HTMLDetailsElement).open)) await section.locator("summary").click();
    await expect(section.locator("li")).toHaveCount(1);
    const row = section.locator("li");
    const session = input.app_feature_sessions.find((s) => s.method_profile_id === id)!;
    for (const [key, value] of Object.entries(session)) {
      const label = key.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
      await expect(row).toContainText(`${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
    }
    await expect(card.getByRole("button", { name: "Load supported preprocessing settings" })).toBeDisabled();
  };
  await importAll();
  for (const profile of input.profiles) {
    await card.getByRole("combobox", { name: "Profile", exact: true }).selectOption(profile.method_profile_id);
    await assertOwner(profile.method_profile_id);
    await reloadApp(page);
    await assertOwner(profile.method_profile_id);
    await importAll();
  }
  const retained = await card.getByRole("combobox", { name: "Profile", exact: true }).inputValue();
  const invalid = structuredClone(input);
  const foreignSession = structuredClone(invalid.app_feature_sessions[0]!);
  foreignSession.feature_session_id = "foreign-session";
  foreignSession.feature_occurrences[0]!.feature_occurrence_id = "foreign-session-occurrence";
  invalid.app_feature_sessions.push(foreignSession);
  invalid.app_feature_sessions[0]!.session_feature_selections[0]!.selected_feature_occurrence_references = ["foreign-session-occurrence"];
  await picker.setInputFiles({ name: "foreign-session.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(invalid)) });
  await expect(page.getByRole("status").filter({ hasText: "Method profile import failed:" })).toContainText("within session");
  await reloadApp(page);
  await assertOwner(retained);
  await picker.setInputFiles({ name: "profile-only.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ profiles: input.profiles })) });
  await expect(card).not.toContainText("App feature sessions");
  await reloadApp(page);
  await expect(card).not.toContainText("App feature sessions");
});
