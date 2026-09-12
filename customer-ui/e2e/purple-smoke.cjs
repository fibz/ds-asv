// Real-browser smoke against the DEPLOYED app on purple.
// This is the check curl cannot do: it proves the JS bundle actually executes.
// The text/plain MIME bug returned 200 to curl but would fail here.
const { chromium } = require("@playwright/test");

const URL = process.env.SMOKE_URL || "https://74.156.0.13:8443/app/sign-in";

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("requestfailed", (r) => failedRequests.push(`${r.url()} :: ${r.failure()?.errorText}`));

  await page.goto(URL, { waitUntil: "networkidle" });

  const title = await page.title();
  const ctaCount = await page.getByRole("link", { name: /Continue with Keycloak/i }).count();
  const ctaHref = ctaCount ? await page.getByRole("link", { name: /Continue with Keycloak/i }).getAttribute("href") : null;
  const passwordFields = await page.locator('input[type="password"]').count();
  const bodyText = (await page.locator("body").innerText()).replace(/\s+/g, " ").trim().slice(0, 160);

  console.log(JSON.stringify({
    url: URL,
    title,
    bundleExecuted: ctaCount > 0,
    ctaHref,
    passwordFields,
    renderedText: bodyText,
    consoleErrors,
    pageErrors,
    failedRequests,
  }, null, 2));

  await browser.close();
  if (ctaCount === 0) { console.error("FAIL: the app did not render its sign-in action"); process.exit(1); }
})();
