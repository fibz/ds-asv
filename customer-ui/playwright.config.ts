import { defineConfig, devices } from "@playwright/test";

const PORT = 5173;
const BASE_URL = `http://127.0.0.1:${PORT}/app/`;

/**
 * Browser smoke path for the customer UI.
 *
 * The no-backend part runs anywhere: it only needs the Vite dev server, which
 * `webServer` starts for us. The authenticated part is skipped unless E2E_LIVE
 * is set (it needs the portal and Keycloak on 127.0.0.1:3000/8080).
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${PORT}`,
    url: BASE_URL,
    // A dev server started by hand (or by another task) is reused, not fought.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
