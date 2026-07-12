// Test account credentials must never be hardcoded in the repo. Set these via
// env vars (locally in a gitignored .env.test, or as CI secrets) before running
// the e2e suite.
export const TEST_ADMIN_EMAIL = process.env.PW_ADMIN_EMAIL;
export const TEST_ADMIN_PASSWORD = process.env.PW_ADMIN_PASSWORD;

export function requireTestCredentials(): { email: string; password: string } {
  if (!TEST_ADMIN_EMAIL || !TEST_ADMIN_PASSWORD) {
    throw new Error(
      "Missing PW_ADMIN_EMAIL / PW_ADMIN_PASSWORD env vars — required to run e2e tests that log in.",
    );
  }
  return { email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD };
}
