/**
 * Produktbilder för demo: loggar in och fotograferar appen i två format —
 * mobil (390x844 @3x) och desktop (1440x900 @2x).
 *
 * Kör:
 *   npm run dev                       # i en egen terminal
 *   PW_EMAIL=... PW_PASSWORD=... npm run screenshots
 *
 * Valfritt:
 *   PW_BASE_URL          appens adress (default http://localhost:5173)
 *   PW_CUSTOMER_EMAIL    kundkonto, om butiksvyn ska fotograferas separat
 *   PW_CUSTOMER_PASSWORD
 *
 * Lösenord läses bara från miljövariabler — skriv aldrig in dem i filen.
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "screenshots");
const BASE = process.env.PW_BASE_URL ?? "http://localhost:5173";

const PROFILES = [
  {
    dir: "mobil",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  { dir: "desktop", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
];

/** Skärmar som fotograferas. `prep` får köra klick innan bilden tas. */
const SHOP_SCREENS = [
  { name: "10-butik-start", path: "/" },
  { name: "11-produktkatalog", path: "/produkter" },
  { name: "12-produktdetalj", path: "/produkt/sipom-giove-skumschampo" },
  {
    name: "13-varukorg",
    path: "/produkt/sipom-giove-skumschampo",
    async prep(page) {
      await page.getByRole("button", { name: /Lägg i varukorg/i }).click();
      await page.goto(`${BASE}/varukorg`, { waitUntil: "domcontentloaded" });
    },
  },
  { name: "14-kassa", path: "/kassa" },
  { name: "15-mina-bestallningar", path: "/bestallningar" },
  { name: "16-konto", path: "/konto" },
];

const WORKSHOP_SCREENS = [
  { name: "20-verkstad-ordrar", path: "/verkstad" },
  { name: "21-verkstad-chatt", path: "/verkstad/chatt" },
  { name: "22-verkstad-produkter", path: "/verkstad/produkter" },
  { name: "23-verkstad-statistik", path: "/verkstad/statistik" },
  { name: "24-verkstad-installningar", path: "/verkstad/installningar" },
];

async function login(page, email, password) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.locator("input[type=email]").first().fill(email);
  await page.locator("input[type=password]").first().fill(password);
  await page.getByRole("button", { name: "Logga in" }).first().click();
  await page.waitForFunction(() => !location.pathname.startsWith("/login"), {
    timeout: 30_000,
  });
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function capture(page, profile, screens) {
  for (const screen of screens) {
    try {
      await page.goto(BASE + screen.path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle").catch(() => {});
      await screen.prep?.(page);
      await page.waitForTimeout(1200);
      const file = path.join(OUT, profile.dir, `${screen.name}.png`);
      await page.screenshot({ path: file });
      console.log("✓", profile.dir, screen.name);
    } catch (err) {
      console.warn("✗", profile.dir, screen.name, "—", err.message.split("\n")[0]);
    }
  }
}

async function run(profile, email, password, screens) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    isMobile: profile.isMobile ?? false,
    hasTouch: profile.hasTouch ?? false,
    locale: "sv-SE",
    timezoneId: "Europe/Stockholm",
  });
  const page = await context.newPage();
  try {
    await login(page, email, password);
    await capture(page, profile, screens);
  } finally {
    await browser.close();
  }
}

const email = process.env.PW_EMAIL;
const password = process.env.PW_PASSWORD;
if (!email || !password) {
  console.error("Saknar PW_EMAIL / PW_PASSWORD — sätt dem innan du kör skriptet.");
  process.exit(1);
}
const customerEmail = process.env.PW_CUSTOMER_EMAIL;
const customerPassword = process.env.PW_CUSTOMER_PASSWORD;

for (const profile of PROFILES) {
  await mkdir(path.join(OUT, profile.dir), { recursive: true });
  // Verkstadskonton landar i /verkstad, kundkonton i butiken. Finns bara ett
  // konto får det fotografera allt det kommer åt.
  await run(profile, email, password, [...WORKSHOP_SCREENS, ...SHOP_SCREENS]);
  if (customerEmail && customerPassword) {
    await run(profile, customerEmail, customerPassword, SHOP_SCREENS);
  }
}
console.log("Klart — bilderna ligger i", OUT);
