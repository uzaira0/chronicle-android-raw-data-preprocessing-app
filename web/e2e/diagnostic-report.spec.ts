import { expect, test } from "./durabilityContext";
import { APP_ONLY_RAW_CSV, MALFORMED_RAW_CSV } from "./fixtures";
import {
  assertNoExternalRequests,
  gotoApp,
  installDeterministicRuntime,
  setInputFile,
  trackExternalRequests,
} from "./helpers";

/** Every value of a fixture that names a participant, a device user or an app. */
function fixtureValues(csv: string): string[] {
  const [, ...rows] = csv.split("\n");
  const values = new Set<string>();
  for (const row of rows) {
    for (const cell of row.split(",")) {
      // Short cells ("1", "") and the column-agnostic words a report also uses
      // would match by coincidence; every other cell must be absent.
      if (cell.length >= 3 && !["Android", "study"].includes(cell)) values.add(cell);
    }
  }
  return [...values];
}

test("@smoke uncaught errors are recorded locally and the copied report holds no file data", async ({
  page,
}) => {
  const tracker = trackExternalRequests(page);
  await installDeterministicRuntime(page);
  await gotoApp(page);

  // A failed run the app reports, about a file named after its participant.
  await setInputFile(page, "raw-file-input", "Raw P01.csv", MALFORMED_RAW_CSV, "text/csv");
  await page.getByRole("tab", { name: /Process/i }).click();
  await page.getByTestId("process-files-button").click();
  await expect(page.locator(".error-text")).toContainText("Invalid event_timestamp");

  // An uncaught error and an unhandled rejection whose messages quote the file.
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('could not read "Target Child" from Raw P01.csv at 2026-03-07 10:00:00');
    });
    void Promise.reject(new Error("lost while reading Raw P01 (com.example.chat)"));
  });
  await page.waitForTimeout(100);

  await page.getByTestId("copy-diagnostic-report").click();
  const text = page.getByTestId("diagnostic-report-text");
  await expect(text).toBeVisible();
  await expect(page.getByTestId("diagnostic-report-status")).not.toBeEmpty();
  const report = await text.inputValue();

  expect(report).toMatch(/^ {2}Version: \S+\+\S+$/m);
  expect(report).toMatch(/^ {2}User agent: .+$/m);
  expect(report).toMatch(/^ {2}Used: .+ of .+$/m);
  expect(report).toContain("[unhandledrejection]");
  expect(report).toMatch(/\[error\] Error: could not read <value> from <file> at <datetime>/);
  expect(report).toMatch(/\[shown\] \S+: .*Invalid event_timestamp/);

  for (const value of [
    "Raw P01",
    "P01",
    ...fixtureValues(MALFORMED_RAW_CSV),
    ...fixtureValues(APP_ONLY_RAW_CSV),
  ]) {
    expect(report, `report contains file data: ${value}`).not.toContain(value);
  }

  await page.getByTestId("diagnostic-report-dialog-cancel").click();
  await expect(text).toHaveCount(0);
  assertNoExternalRequests(tracker);
});
