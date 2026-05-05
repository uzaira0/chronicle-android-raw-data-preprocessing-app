import { defineConfig, devices } from "@playwright/test";

delete process.env.FORCE_COLOR;

const SMOKE_BROWSERS = Boolean(process.env.SMOKE_BROWSERS);

const allBrowserProjects = [
  { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  { name: "webkit", use: { ...devices["Desktop Safari"] } },
];

const smokeBrowserProjects = allBrowserProjects.map((p) => ({
  ...p,
  grep: /@smoke/,
}));

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "html" : "list",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "sh -c 'npm run build && npm run preview'",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    cwd: ".",
  },
  projects: SMOKE_BROWSERS ? smokeBrowserProjects : allBrowserProjects,
});
