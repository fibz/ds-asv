// customer-ui/e2e/smoke.spec.ts
import { test, expect } from "@playwright/test";

/**
 * PART 1 — runs with NO backend.
 *
 * The app is served under the `/app/` base path: `vite.config.ts` sets
 * `base: "/app/"` and `main.tsx` sets `BrowserRouter basename="/app"`. If those
 * two disagree, nothing mounts. Loading the base path proves they agree.
 *
 * The sign-in landing is the one screen with no data dependency (no queries),
 * so it is the correct thing to assert with the portal switched off — and it
 * must offer exactly one action, "Continue with Keycloak".
 *
 * Note: the app's own root route ("/") is Home, which reads the API; with the
 * portal down it renders the shell with the query placeholders. The sign-in
 * landing is therefore asserted at its own route, `/app/sign-in`.
 */
test.describe("no backend", () => {
  test("boots at its base path and serves the sign-in landing with one action", async ({ page }) => {
    await page.goto("/");
    // A 404 or a crate of console errors would leave #root empty.
    await expect(page.locator("#root")).not.toBeEmpty();

    await page.goto("sign-in");
    await expect(page.getByRole("link", { name: "Continue with Keycloak" })).toBeVisible();
    await expect(page.getByRole("link")).toHaveCount(1);
  });
});

/**
 * PART 2 — the real journey. Needs the portal (127.0.0.1:3000) and Keycloak
 * (127.0.0.1:8080) running. Skipped unless E2E_LIVE=1, so the suite stays green
 * on a bare checkout.
 */
test.describe("authenticated journey", () => {
  test.skip(!process.env.E2E_LIVE, "set E2E_LIVE=1 with the portal and Keycloak running");

  test("signs in, then walks home → scope → reports", async ({ page }) => {
    const user = process.env.E2E_USER ?? "";
    const password = process.env.E2E_PASSWORD ?? "";
    if (!user || !password) {
      throw new Error("E2E_LIVE is set but E2E_USER / E2E_PASSWORD are not");
    }

    // Sign-in → the portal's Keycloak code flow.
    await page.goto("sign-in");
    await page.getByRole("link", { name: "Continue with Keycloak" }).click();
    await page.getByLabel(/username|email/i).fill(user);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();

    // Home — the quarter checklist.
    await expect(page.getByRole("heading", { name: /checklist/i })).toBeVisible();

    // Scope.
    await page.getByRole("link", { name: /Scope/ }).click();
    await expect(page.getByRole("heading", { name: "Scope" })).toBeVisible();

    // Reports.
    await page.getByRole("link", { name: /Reports/ }).click();
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();
  });
});
