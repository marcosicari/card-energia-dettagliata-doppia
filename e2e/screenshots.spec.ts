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
