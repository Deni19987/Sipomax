import { test } from "@playwright/test";
import { requireTestCredentials } from "./test-credentials";

test.setTimeout(120000);

async function login(page: any) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  const { email, password } = requireTestCredentials();
  await page.locator("input[type='email']").first().fill(email);
  await page.locator("input[type='password']").first().fill(password);
  await page.locator("button[type='submit']").first().click();
  await page.waitForFunction(() => !window.location.pathname.startsWith("/login"), { timeout: 40000 });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
}

test("inspect Fortnox connection status", async ({ page }) => {
  const statusBodies: string[] = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("_serverFn")) {
      const body = await response.text().catch(() => "");
      if (body.includes("connected") || body.includes("expires") || body.includes("fortnox") || body.includes("Fortnox")) {
        statusBodies.push(`${url}\n${body.slice(0, 500)}`);
      }
    }
  });

  await login(page);
  await page.goto("/settings");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "tests/screenshots/dbg-settings-full.png", fullPage: true });

  // Find the Fortnox card region text
  const bodyText = await page.locator("body").innerText();
  const idx = bodyText.indexOf("Fortnox");
  console.log("FORTNOX CARD TEXT:\n", bodyText.slice(idx, idx + 400));

  console.log("===== STATUS SERVER FN BODIES =====");
  for (const b of statusBodies) console.log(b, "\n---");
});
