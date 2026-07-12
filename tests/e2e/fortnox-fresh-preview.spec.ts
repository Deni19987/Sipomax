import { test, expect } from "@playwright/test";
import { requireTestCredentials } from "./test-credentials";

test.setTimeout(240000);

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

test("find a job with a FRESH preview button and click it", async ({ page }) => {
  const fnResponses: string[] = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("_serverFn")) {
      const body = await response.text().catch(() => "");
      if (body.includes("Fortnox") || body.includes("$TSR/Error")) {
        fnResponses.push(body.slice(0, 400));
      }
    }
  });

  await login(page);

  // Collect candidate job IDs from the dashboard
  const jobLinks = page.locator("a[href*='/jobs/']");
  await expect(jobLinks.first()).toBeVisible({ timeout: 15000 });
  const hrefs = await jobLinks.evaluateAll((els: any[]) =>
    Array.from(new Set(els.map((e) => e.getAttribute("href")))).filter(Boolean),
  );
  const jobIds = hrefs
    .map((h: string) => h.split("/jobs/")[1]?.split("/")[0])
    .filter((v: string, i: number, a: string[]) => v && a.indexOf(v) === i);
  console.log("Candidate jobs:", jobIds.length);

  for (const jobId of jobIds.slice(0, 20)) {
    await page.goto(`/jobs/${jobId}#invoice`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const freshBtn = page.locator("button:has-text('Förhandsgranska PDF')").first();
    const hasFresh = await freshBtn.isVisible({ timeout: 4000 }).catch(() => false);
    if (!hasFresh) {
      console.log(`job ${jobId}: no fresh preview button (has invoice or no billables) — skip`);
      continue;
    }
    console.log(`job ${jobId}: FRESH preview button found — clicking`);
    await freshBtn.click();

    const dialog = page.locator("text=Förhandsgranskning av faktura");
    const toast = page.locator("[data-sonner-toast]").first();
    const result = await Promise.race([
      dialog.waitFor({ state: "visible", timeout: 120000 }).then(() => "DIALOG"),
      toast.waitFor({ state: "visible", timeout: 120000 }).then(() => "TOAST"),
    ]).catch(() => "TIMEOUT");
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `tests/screenshots/fresh-${jobId}.png`, fullPage: true });
    const toastText = await toast.textContent().catch(() => "");
    console.log(`RESULT=${result} TOAST="${toastText}"`);
    console.log("FN:", fnResponses.filter((r) => r.includes("Error")).slice(-1)[0] ?? "(no error fn)");
    return; // tested one fresh job; stop to avoid creating many drafts
  }
  console.log("No job with a fresh preview button was found in the first 12 jobs.");
});
