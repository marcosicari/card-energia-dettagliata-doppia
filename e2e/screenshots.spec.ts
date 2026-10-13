import { expect, test } from "@playwright/test";

// Renders the images used in README.md. Run: npm run screenshots
const shots: Array<{ scenario: string; file: string; before?: (page: import("@playwright/test").Page) => Promise<void> }> = [
  {
    scenario: "floors",
    file: "card-with-floors",
    before: async (page) => {
      await page.locator("detailed-energy-card button.node[title=Küche]").click();
    },
  },
  {
    scenario: "flat",
    file: "card-without-floors",
    before: async (page) => {
      await page.locator("detailed-energy-card button.node[title=Küche]").click();
    },
  },
  {
    scenario: "wrap",
    file: "card-many-rooms-wrapped",
    before: async (page) => {
      await page.locator("detailed-energy-card button.node[title=Garage]").click();
    },
  },
  {
    scenario: "thresholds",
    file: "card-thresholds",
    before: async (page) => {
      await page.locator("detailed-energy-card button.node[title=Küche]").click();
    },
  },
  {
    scenario: "energy",
    file: "card-energy",
    // the statistics arrive after the first render
    before: async (page) => {
      await expect(page.locator("detailed-energy-card .pill small", { hasText: "kWh" }).first()).toBeVisible();
    },
  },
  { scenario: "floors", file: "card-all-rooms" }, // all rooms of the floor are selected by default
];

for (const { scenario, file, before } of shots) {
  test(`screenshot ${file}`, async ({ page }) => {
    await page.goto(`/dev/index.html?scenario=${scenario}`);
    await expect(page.locator("detailed-energy-card .path")).toContainText("Zuhause");
    await expect(page.locator("detailed-energy-card .path")).not.toContainText("eg");
    await before?.(page);
    await page.locator("detailed-energy-card").screenshot({ path: `docs/screenshots/${file}.png` });
  });
}

// The editor, rendered in a dialog like the one of Home Assistant with demo data (dev/index.html?editor=editor).
// The form fields are drawn by a stand-in for <ha-form> (dev/ha-form-stub.js).
test.describe("editor screenshots", () => {
  const dialog = (page: import("@playwright/test").Page) => page.locator(".dlg");
  const editor = (page: import("@playwright/test").Page) => page.locator("detailed-energy-card-editor");
  const open = async (page: import("@playwright/test").Page) => {
    await page.setViewportSize({ width: 1000, height: 1080 });
    await page.goto("/dev/index.html?editor=editor");
    await expect(editor(page)).toBeVisible();
    await expect(page.locator("detailed-energy-card .path")).not.toHaveText("");
    await page.waitForTimeout(600); // the card measures its width after the first render
  };
  const toTop = (locator: import("@playwright/test").Locator) => locator.evaluate((el) => el.scrollIntoView({ block: "start" }));
  const shot = (page: import("@playwright/test").Page, file: string) => dialog(page).screenshot({ path: `docs/screenshots/${file}.png` });

  test("editor-general", async ({ page }) => {
    await open(page);
    await page.locator(".pane-l").evaluate((el) => (el.scrollTop = 150));
    await shot(page, "editor-general");
  });

  test("editor-thresholds", async ({ page }) => {
    await open(page);
    await editor(page).locator("button.title.section").click();
    await editor(page).locator(".levels button", { hasText: "Räume" }).click();
    await editor(page).locator(".item .head button.title", { hasText: "ab 800 W" }).click();
    await toTop(editor(page).locator("button.title.section"));
    await page.locator('detailed-energy-card button.node[title="EG"]').click();
    await page.locator('detailed-energy-card button.node[title="Küche"]').click();
    await page.waitForTimeout(700); // the other floors and rooms have faded out
    await shot(page, "editor-thresholds");
  });

  test("editor-energy", async ({ page }) => {
    await open(page);
    await editor(page).locator("h3", { hasText: "Zuhause" }).first().scrollIntoViewIfNeeded();
    await editor(page).locator(".item .head button.title", { hasText: "PV" }).click();
    await toTop(editor(page).locator("h3", { hasText: "Zuhause" }).first());
    await page.locator("detailed-energy-card .modes button", { hasText: "Heute" }).click();
    await expect(page.locator("detailed-energy-card .pill small", { hasText: "kWh" }).first()).toBeVisible();
    await shot(page, "editor-energy");
  });

  test("editor-structure", async ({ page }) => {
    await open(page);
    await editor(page).locator(".item .head button.title", { hasText: "EG" }).first().click();
    await editor(page).locator(".item .head button.title", { hasText: "Küche" }).first().click();
    await toTop(editor(page).locator("h3", { hasText: "Struktur" }));
    await page.locator("detailed-energy-card .modes button", { hasText: "Heute" }).click();
    await page.locator('detailed-energy-card button.node[title="EG"]').click();
    await page.locator('detailed-energy-card button.node[title="Küche"]').click();
    await expect(page.locator("detailed-energy-card .pill small", { hasText: "kWh" }).first()).toBeVisible();
    await page.waitForTimeout(700); // the other floors and rooms have faded out
    await shot(page, "editor-structure");
  });
});
