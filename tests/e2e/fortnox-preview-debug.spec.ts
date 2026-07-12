import { test, expect } from "@playwright/test";
import { requireTestCredentials } from "./test-credentials";

test.setTimeout(180000);

async function login(page: any) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  const { email, password } = requireTestCredentials();
  await page.locator("input[type='email']").first().fill(email);
  await page.locator("input[type='password']").first().fill(password);
  await page.locator("button[type='submit']").first().click();
  await page
    .waitForFunction(() => !window.location.pathname.startsWith("/login"), { timeout: 40000 })
    .catch(async () => {
      const toastText = await page.locator("[data-sonner-toast]").first().textContent().catch(() => "");
      throw new Error(`Login failed — still on /login. Toast: "${toastText}"`);
    });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
}

test("debug Fortnox invoice preview", async ({ page }) => {
  const serverFnResponses: string[] = [];

  page.on("response", async (response) => {
    const url = response.url();
    // Capture the server-function POST that handles the preview
    if (url.includes("generateInvoicePreviewPdf") || url.includes("_serverFn") || /\/jobs\//.test(url) && response.request().method() === "POST") {
      const body = await response.text().catch(() => "");
      if (body && (body.includes("Fortnox") || body.includes("error") || body.includes("invoice") || !response.ok())) {
        serverFnResponses.push(`[${response.status()}] ${url}\n${body.slice(0, 600)}`);
      }
    }
  });

  await login(page);

  // Go straight to a job. Pull the first job link from the dashboard.
  const jobLinks = page.locator("a[href*='/jobs/']");
  await expect(jobLinks.first()).toBeVisible({ timeout: 15000 });
  const href = await jobLinks.first().getAttribute("href");
  const jobId = href?.split("/jobs/")[1]?.split("/")[0];
  console.log("JOB ID:", jobId);

  await page.goto(`/jobs/${jobId}#invoice`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "tests/screenshots/dbg-01-invoice-tab.png", fullPage: true });

  // Click whichever preview button is present
  const previewBtn = page.locator("button:has-text('Förhandsgranska PDF')").first();
  const draftBtn = page.locator("button:has-text('Förhandsgranska utkastet')").first();

  let clicked = "";
  if (await previewBtn.isVisible({ timeout: 8000 }).catch(() => false)) {
    clicked = "Förhandsgranska PDF";
    await previewBtn.click();
  } else if (await draftBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    clicked = "Förhandsgranska utkastet";
    await draftBtn.click();
  } else {
    const bodyText = await page.locator("body").innerText();
    console.log("NO PREVIEW BUTTON. Page text:\n", bodyText.slice(0, 1000));
    await page.screenshot({ path: "tests/screenshots/dbg-02-no-button.png", fullPage: true });
    throw new Error("No preview button visible on invoice tab");
  }
  console.log("CLICKED:", clicked);

  // Wait for EITHER the success dialog OR an error toast
  const dialog = page.locator("text=Förhandsgranskning av faktura");
  const toast = page.locator("[data-sonner-toast]").first();

  const result = await Promise.race([
    dialog.waitFor({ state: "visible", timeout: 120000 }).then(() => "DIALOG"),
    toast.waitFor({ state: "visible", timeout: 120000 }).then(() => "TOAST"),
  ]).catch(() => "TIMEOUT");

  // Give the toast a moment to render full text
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "tests/screenshots/dbg-03-after-click.png", fullPage: true });

  const toastText = await toast.textContent().catch(() => "");
  console.log("RESULT:", result);
  console.log("TOAST TEXT:", toastText);
  console.log("===== SERVER FN RESPONSES =====");
  for (const r of serverFnResponses) console.log(r, "\n---");

  if (result === "DIALOG") {
    console.log("SUCCESS — preview dialog opened, no error.");
  } else {
    console.log("ERROR SURFACED ↑");
  }
});
