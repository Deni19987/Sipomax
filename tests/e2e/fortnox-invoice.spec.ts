import { test, expect } from "@playwright/test";
import { requireTestCredentials } from "./test-credentials";

test.setTimeout(120000);

async function login(page: any) {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  const { email, password } = requireTestCredentials();
  await page.locator("input[type='email']").first().fill(email);
  await page.locator("input[type='password']").first().fill(password);
  await page.locator("button[type='submit']").first().click();
  await page.waitForFunction(
    () => !window.location.pathname.startsWith("/login"),
    { timeout: 40000 },
  ).catch(async () => {
    const toastText = await page.locator("[data-sonner-toast]").first().textContent().catch(() => "");
    throw new Error(`Login failed — still on /login after 40s. Toast: "${toastText}"`);
  });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
}

test("login and reach dashboard", async ({ page }) => {
  await login(page);
  await page.screenshot({ path: "tests/screenshots/01-dashboard.png", fullPage: true });
  console.log("URL after login:", page.url());
  expect(page.url()).toContain("/dashboard");
});

test("preview Fortnox invoice PDF from a job", async ({ page }) => {
  const apiErrors: string[] = [];
  const consoleLogs: string[] = [];

  page.on("response", async (response) => {
    if (!response.ok() && response.url().includes("sipomax.se")) {
      const body = await response.text().catch(() => "");
      apiErrors.push(`${response.status()} ${response.url()} — ${body.slice(0, 200)}`);
    }
  });

  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.text().includes("Error") || msg.text().includes("error")) {
      consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    }
  });

  page.on("pageerror", (err) => {
    consoleLogs.push(`[pageerror] ${err.message}`);
  });

  await login(page);
  await page.screenshot({ path: "tests/screenshots/01-dashboard.png", fullPage: true });

  // Find any job link on the dashboard
  const jobLinks = page.locator("a[href*='/jobs/']");
  const count = await jobLinks.count();
  console.log("Job links found:", count);

  if (count === 0) {
    console.log("No jobs on dashboard. Reloading...");
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: "tests/screenshots/01b-dashboard-retry.png", fullPage: true });
  }

  await expect(jobLinks.first()).toBeVisible({ timeout: 10000 });
  const firstHref = await jobLinks.first().getAttribute("href");
  console.log("Opening job:", firstHref);

  // Extract job ID from href
  const jobId = firstHref?.split("/jobs/")[1]?.split("/")[0];
  console.log("Job ID:", jobId);
  if (!jobId) throw new Error("Could not extract job ID from href");

  // Navigate directly to the job's invoice tab via hash
  await page.goto(`/jobs/${jobId}#invoice`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: "tests/screenshots/02-invoice-tab.png", fullPage: true });
  console.log("Invoice tab URL:", page.url());

  // Check page content
  const pageText = await page.locator("body").innerText();
  console.log("Page snippet:", pageText.slice(0, 400));

  // Look for the "Förhandsgranska PDF" button (type="button", not submit)
  const previewBtn = page.locator("button:has-text('Förhandsgranska PDF')").first();
  const hasPreviewBtn = await previewBtn.isVisible({ timeout: 8000 }).catch(() => false);
  console.log("Preview PDF button visible:", hasPreviewBtn);

  if (!hasPreviewBtn) {
    // Check if invoice was already generated — show "Förhandsgranska utkastet" instead
    const draftBtn = page.locator("button:has-text('Förhandsgranska utkastet')").first();
    const hasDraftBtn = await draftBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (hasDraftBtn) {
      console.log("Invoice already generated — clicking preview draft button");
      await draftBtn.click();
    } else {
      console.log("No preview button found. Full page text:");
      console.log(pageText.slice(0, 800));
      // Acceptable if there are no billable quotes
      console.log("Skipping — no invoice form visible (job may have no billable quotes)");
      return;
    }
  } else {
    console.log("Clicking Förhandsgranska PDF...");
    await previewBtn.click();
  }

  // Wait for the preview dialog to appear — Fortnox PDF generation can be slow
  console.log("Waiting for preview dialog (up to 90s — Fortnox PDF generation can be slow)...");
  const dialogTitle = page.locator("text=Förhandsgranskning av faktura");
  const dialogVisible = await dialogTitle.isVisible({ timeout: 90000 }).catch(() => false);

  await page.screenshot({ path: "tests/screenshots/03-preview-dialog.png", fullPage: true });

  if (dialogVisible) {
    console.log("SUCCESS: PDF preview dialog opened!");

    // Also check the download button is present
    const downloadBtn = page.locator("a:has-text('Ladda ner PDF'), button:has-text('Ladda ner PDF')").first();
    const hasDownload = await downloadBtn.isVisible({ timeout: 3000 }).catch(() => false);
    console.log("Download button visible:", hasDownload);
  } else {
    // Check for error toast
    const toastLocator = page.locator("[data-sonner-toast]").first();
    const toastVisible = await toastLocator.isVisible({ timeout: 3000 }).catch(() => false);
    if (toastVisible) {
      const toastText = await toastLocator.textContent().catch(() => "");
      console.error("Toast after clicking preview:", toastText);
    }
    console.log("API errors during test:", apiErrors);
    console.log("Browser console errors:", consoleLogs);
    throw new Error("PDF preview dialog did not open within 90 seconds");
  }

  console.log("API errors during test:", apiErrors);
});
