import { test, expect } from "@playwright/test";
import { requireTestCredentials } from "./test-credentials";

test("login page loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/.+/);
  await expect(
    page.locator("input[type='email'], input[type='text']").first()
  ).toBeVisible({ timeout: 10000 });
});

test("login page has email and password fields", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const emailInput = page.locator("input[type='email']").first();
  const passwordInput = page.locator("input[type='password']").first();

  await expect(emailInput).toBeVisible({ timeout: 10000 });
  await expect(passwordInput).toBeVisible({ timeout: 10000 });
});

test("can navigate to login page", async ({ page }) => {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  const body = page.locator("body");
  await expect(body).toBeVisible();
});

test("login with valid credentials redirects to dashboard", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const { email, password } = requireTestCredentials();
  await page.locator("input[type='email']").first().fill(email);
  await page.locator("input[type='password']").first().fill(password);

  await page
    .locator("button:has-text('Logga in'), button[type='submit']")
    .first()
    .click();

  // TanStack Router uses history.pushState — waitForNavigation does NOT fire.
  await page.waitForFunction(
    () => !window.location.pathname.startsWith("/login"),
    { timeout: 30000 },
  ).catch(async () => {
    const toastText = await page.locator("[data-sonner-toast]").first().textContent().catch(() => "");
    throw new Error(`Login failed — still on /login. Toast: "${toastText}"`);
  });
  await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});

  // Login form should no longer be visible after successful auth
  const loginForm = page.locator("input[type='password']");
  await expect(loginForm).not.toBeVisible({ timeout: 10000 });

  // No critical JS errors
  const criticalErrors = errors.filter(
    (e) => !e.includes("ResizeObserver") && !e.includes("Non-Error")
  );
  expect(criticalErrors).toHaveLength(0);
});

test("no unhandled JS errors on page load", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const criticalErrors = errors.filter(
    (e) => !e.includes("ResizeObserver") && !e.includes("Non-Error")
  );
  expect(criticalErrors).toHaveLength(0);
});
