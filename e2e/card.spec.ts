import { expect, test, type Page } from "@playwright/test";

const open = async (page: Page, scenario: string) => {
  await page.goto(`/dev/index.html?scenario=${scenario}`);
  // registries are loaded asynchronously; names replace the ids once they arrive
  await expect(page.locator("detailed-energy-card .path")).not.toHaveText("");
};
const node = (page: Page, title: string) => page.locator(`detailed-energy-card button.node[title="${title}"]`);

test("floors: shows sources, floors, rooms and the consumer list", async ({ page }) => {
  await open(page, "floors");
  await expect(page.locator("detailed-energy-card h2")).toHaveText("Energiefluss");
  await expect(page.locator("detailed-energy-card .badge")).toContainText("Autarkie 92 %");
  await expect(page.locator("detailed-energy-card .path")).toHaveText("Zuhause › EG");
  for (const t of ["PV", "Batterie", "Netz", "EG", "OG", "Keller", "Küche", "Wohnzimmer", "Flur"]) {
    await expect(node(page, t)).toBeVisible();
  }
  await expect(page.locator("detailed-energy-card .detail .row").first()).toContainText("Backofen");
  await expect(page.locator("detailed-energy-card .detail-head")).toContainText("6 Verbraucher");
});

test("floors: choosing a floor swaps the room row", async ({ page }) => {
  await open(page, "floors");
  await node(page, "OG").click();
  await expect(page.locator("detailed-energy-card .path")).toHaveText("Zuhause › OG");
  await expect(node(page, "Bad")).toBeVisible();
  await expect(page.locator("detailed-energy-card .circle.room.selected")).toHaveCount(1); // OG has one room
  await expect(node(page, "Küche")).toHaveCount(0);
});

test("opening a floor selects all of its rooms", async ({ page }) => {
  await open(page, "floors");
  await expect(page.locator("detailed-energy-card .circle.room.selected")).toHaveCount(3);
  await node(page, "Küche").click(); // narrow down to one room ...
  await node(page, "OG").click();
  await node(page, "EG").click(); // ... opening a floor again selects all of its rooms
  await expect(page.locator("detailed-energy-card .path")).toHaveText("Zuhause › EG");
  await expect(page.locator("detailed-energy-card .circle.room.selected")).toHaveCount(3);
  await expect(page.locator("detailed-energy-card .detail-head")).toContainText("6 Verbraucher");
});

test("choosing a room selects just that room, clicking it again selects all again", async ({ page }) => {
  await open(page, "floors");
  await node(page, "Küche").click();
  await expect(page.locator("detailed-energy-card .path")).toHaveText("Zuhause › EG › Küche");
  await expect(page.locator("detailed-energy-card .circle.room.selected")).toHaveCount(1);
  await expect(page.locator("detailed-energy-card .detail-head")).toContainText("4 Verbraucher");
  await node(page, "Flur").click();
  await expect(page.locator("detailed-energy-card .path")).toHaveText("Zuhause › EG › Flur");
  await node(page, "Flur").click();
  await expect(page.locator("detailed-energy-card .path")).toHaveText("Zuhause › EG");
  await expect(page.locator("detailed-energy-card .circle.room.selected")).toHaveCount(3);
  await expect(page.locator("detailed-energy-card .detail-head")).toContainText("6 Verbraucher");
});

test("flat without floors: rooms hang directly under the home", async ({ page }) => {
  await open(page, "flat");
  await expect(page.locator("detailed-energy-card button.node[title=EG]")).toHaveCount(0);
  await expect(page.locator("detailed-energy-card .path")).toHaveText("Zuhause");
  await expect(page.locator("detailed-energy-card .circle.room")).toHaveCount(5);
  await expect(page.locator("detailed-energy-card .circle.room.selected")).toHaveCount(5);
  await expect(node(page, "Balkon-PV")).toBeVisible();
});

test("many rooms scroll horizontally by default", async ({ page }) => {
  await open(page, "many");
  const scroll = page.locator("detailed-energy-card .scroll");
  const [sw, cw] = await scroll.evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(sw).toBeGreaterThan(cw);
});

test("many rooms wrap into two rows when enabled", async ({ page }) => {
  await open(page, "wrap");
  const scroll = page.locator("detailed-energy-card .scroll");
  const [sw, cw] = await scroll.evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(sw).toBeLessThanOrEqual(cw);
  const tops = await page.locator("detailed-energy-card .circle.room").evaluateAll((els) =>
    [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))],
  );
  expect(tops).toHaveLength(2);
});

test("wrapping rooms is skipped when a single row has enough room", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto("/dev/index.html?scenario=wrap&width=1200");
  await expect(page.locator("detailed-energy-card .circle.room").first()).toBeVisible();
  const tops = await page.locator("detailed-energy-card .circle.room").evaluateAll((els) =>
    [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))],
  );
  expect(tops).toHaveLength(1);
});

test.describe("energy mode", () => {
  // a fixed clock keeps the length of "week" and "month" (and so the numbers of the dev stub) the same on every day
  const fixClock = (page: Page) =>
    page.addInitScript(() => {
      const Real = Date;
      const fixed = new Real("2026-10-13T12:00:00Z").getTime();
      class Fake extends Real {
        constructor(...args: unknown[]) {
          if (args.length) super(...(args as [string]));
          else super(fixed);
        }
        static now() {
          return fixed;
        }
      }
      (window as unknown as { Date: unknown }).Date = Fake;
    });
  const mode = (page: Page, label: string) => page.locator("detailed-energy-card .modes button", { hasText: label });
  const value = (page: Page, title: string) => node(page, title).locator(".value, .pill small").first();

  test("shows the energy of the period in kWh and the switch for the views", async ({ page }) => {
    await fixClock(page);
    await open(page, "energy");
    await expect(mode(page, "Jetzt")).toBeVisible();
    await expect(mode(page, "Heute")).toHaveAttribute("aria-pressed", "true");
    await expect(value(page, "PV")).toHaveText("12,4 kWh");
    await expect(page.locator("detailed-energy-card .badge")).toContainText("Autarkie 74 %");
    await expect(node(page, "EG").locator("small")).toHaveText("11,8 kWh");
    // no animation and no threshold colors in the energy mode
    await expect(page.locator("detailed-energy-card path.line.flowing")).toHaveCount(0);
    // the coffee machine has no energy sensor
    await expect(page.locator("detailed-energy-card .detail .row", { hasText: "Kaffeemaschine" })).toContainText("Kein Energiesensor konfiguriert");
  });

  test("switches between now, today, week and month", async ({ page }) => {
    await fixClock(page);
    await open(page, "energy");
    await expect(value(page, "PV")).toHaveText("12,4 kWh");
    await mode(page, "Woche").click();
    await expect(mode(page, "Woche")).toHaveAttribute("aria-pressed", "true");
    await expect(value(page, "PV")).toHaveText("24,8 kWh");
    await mode(page, "Monat").click();
    await expect(value(page, "PV")).toHaveText("161,2 kWh");
    await mode(page, "Jetzt").click();
    await expect(mode(page, "Jetzt")).toHaveAttribute("aria-pressed", "true");
    await expect(value(page, "PV")).toHaveText("3,42 kW");
    await expect(page.locator("detailed-energy-card path.line.flowing").first()).toBeAttached();
  });

  test("remembers the view", async ({ page }) => {
    await fixClock(page);
    await open(page, "energy");
    await mode(page, "Woche").click();
    await expect(value(page, "PV")).toHaveText("24,8 kWh");
    await page.reload();
    await expect(mode(page, "Woche")).toHaveAttribute("aria-pressed", "true");
    await expect(value(page, "PV")).toHaveText("24,8 kWh");
  });

  test("loads again when the card is detached while the statistics are on their way", async ({ page }) => {
    await open(page, "energy");
    await page.evaluate(() => {
      const el = document.querySelector("detailed-energy-card") as unknown as {
        _hass: { callWS(m: { type: string }): Promise<unknown> };
        _config: object;
        setConfig(c: object): void;
      };
      const w = window as unknown as { __stat: number };
      w.__stat = 0;
      const orig = el._hass.callWS.bind(el._hass);
      // the first request never answers, like one that was cut off by moving the card
      el._hass.callWS = (m) => (m.type.startsWith("recorder") && ++w.__stat === 1 ? new Promise(() => {}) : orig(m));
      el.setConfig(el._config);
      const host = el as unknown as HTMLElement;
      host.remove();
      document.body.appendChild(host);
    });
    await expect(page.locator("detailed-energy-card .modes .status")).toHaveCount(0);
    await expect(value(page, "PV")).toHaveText("12,4 kWh");
    expect(await page.evaluate(() => (window as unknown as { __stat: number }).__stat)).toBe(2);
  });

  test("says so when the statistics cannot be loaded", async ({ page }) => {
    await page.goto("/dev/index.html?scenario=energy&energyError=1");
    await expect(page.locator("detailed-energy-card .modes .status.warn")).toHaveText("Energiedaten nicht verfügbar");
  });

  test("a card without energy sensors has no switch", async ({ page }) => {
    await open(page, "floors");
    await expect(page.locator("detailed-energy-card .modes")).toHaveCount(0);
  });
});

test.describe("consumer list options", () => {
  const configure = (page: Page, options: object) =>
    page.evaluate((o) => {
      const el = document.querySelector("detailed-energy-card") as unknown as { _config: { options?: object }; setConfig(c: object): void };
      el.setConfig({ ...el._config, options: { ...el._config.options, ...o } });
    }, options);

  test("the list can be hidden", async ({ page }) => {
    await open(page, "floors");
    await expect(page.locator("detailed-energy-card .detail")).toBeVisible();
    await configure(page, { show_consumers: false });
    await expect(page.locator("detailed-energy-card .detail")).toHaveCount(0);
    // the diagram is still there
    await expect(node(page, "Küche")).toBeVisible();
  });

  test("only active consumers can be listed", async ({ page }) => {
    await open(page, "floors");
    await expect(page.locator("detailed-energy-card .detail .row.idle")).not.toHaveCount(0);
    await expect(page.locator("detailed-energy-card .detail-head")).toContainText("6 Verbraucher");
    await configure(page, { only_active_consumers: true });
    await expect(page.locator("detailed-energy-card .detail .row.idle")).toHaveCount(0);
    await expect(page.locator("detailed-energy-card .detail-head")).toContainText("4 / 6 Verbraucher");
    await expect(page.locator("detailed-energy-card .detail .row")).toContainText(["Backofen"]);
  });

  test("a room with nothing active says so", async ({ page }) => {
    await open(page, "floors");
    await configure(page, { only_active_consumers: true });
    await node(page, "Flur").click();
    await expect(page.locator("detailed-energy-card .detail .empty")).toHaveText("Keine aktiven Verbraucher");
  });
});

test.describe("focus_selected", () => {
  const home = (page: Page) => page.locator("detailed-energy-card button.node:has(.circle.home)");
  const left = async (page: Page, title: string) => Math.round(await node(page, title).evaluate((el) => el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2));
  const hidden = (page: Page, title: string) => expect(node(page, title)).toHaveCSS("opacity", "0");
  const shown = (page: Page, title: string) => expect(node(page, title)).not.toHaveClass(/ghost/);

  test("a click on an element always shows its children, the selected one slides to the middle", async ({ page }) => {
    await open(page, "focus");
    // it starts with the first level fully visible: all floors, spread out, and no room row
    await shown(page, "EG");
    await shown(page, "OG");
    await shown(page, "Keller");
    await expect(node(page, "Küche")).toHaveCount(0);
    await expect(page.locator("detailed-energy-card .path")).toHaveText("Zuhause");

    // a floor slides to the middle and the other floors fade out behind it
    await node(page, "EG").click();
    await hidden(page, "OG");
    await expect(node(page, "Küche")).toBeVisible();

    // the home shows all floors again, spread out
    await home(page).click();
    await shown(page, "OG");
    await expect(node(page, "OG")).toHaveCSS("opacity", "1");
    await expect(node(page, "Küche")).toHaveCount(0);
    expect(await left(page, "EG")).toBeLessThan(await left(page, "OG"));
    expect(await left(page, "OG")).toBeLessThan(await left(page, "Keller"));

    // a floor slides to the middle and the other floors fade out behind it
    await node(page, "OG").click();
    await hidden(page, "EG");
    await hidden(page, "Keller");
    await expect(node(page, "OG")).toHaveCSS("opacity", "1");
    await expect(node(page, "Bad")).toBeVisible();
    expect(await left(page, "EG")).toBe(await left(page, "OG"));

    // a room slides to the middle, the other rooms fade out
    await home(page).click();
    await node(page, "EG").click();
    await expect(node(page, "Wohnzimmer")).toHaveCSS("opacity", "1");
    await node(page, "Küche").click();
    await expect(page.locator("detailed-energy-card .path")).toHaveText("Zuhause › EG › Küche");
    await hidden(page, "Wohnzimmer");
    await hidden(page, "Flur");
    await expect(node(page, "Küche")).toHaveCSS("opacity", "1");
    expect(await left(page, "Küche")).toBe(await left(page, "EG"));

    // the floor shows all its rooms again, also when it is already selected
    await node(page, "EG").click();
    await expect(page.locator("detailed-energy-card .path")).toHaveText("Zuhause › EG");
    await expect(node(page, "Wohnzimmer")).toHaveCSS("opacity", "1");
    await expect(node(page, "Küche")).toHaveCSS("opacity", "1");
  });

  test("without floors the rooms hang directly under the home and work the same way", async ({ page }) => {
    await open(page, "flat");
    // the scenario has no focus option of its own: turn it on
    await page.evaluate(() => {
      const el = document.querySelector("detailed-energy-card") as unknown as { _config: { options?: object }; setConfig(c: object): void };
      el.setConfig({ ...el._config, options: { ...el._config.options, focus_selected: true } });
    });
    const rooms = page.locator("detailed-energy-card button.node:has(.circle.room)");
    const centers = () => rooms.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left + e.getBoundingClientRect().width / 2)));
    // all rooms are visible and spread out, none is selected
    await expect(page.locator("detailed-energy-card .path")).toHaveText("Zuhause");
    await expect(rooms).toHaveCount(5);
    const spread = await centers();
    expect(new Set(spread).size).toBe(5);

    // a room slides to the middle, the others fade out behind it
    await node(page, "Küche").click();
    await expect(page.locator("detailed-energy-card .path")).toHaveText("Zuhause › Küche");
    await hidden(page, "Bad");
    await expect(node(page, "Küche")).toHaveCSS("opacity", "1");
    expect(new Set(await centers()).size).toBe(1);

    // clicking the selected room again keeps it, the home shows all rooms again
    await node(page, "Küche").click();
    await expect(page.locator("detailed-energy-card .path")).toHaveText("Zuhause › Küche");
    await home(page).click();
    await expect(page.locator("detailed-energy-card .path")).toHaveText("Zuhause");
    await expect(node(page, "Bad")).toHaveCSS("opacity", "1");
    expect(await centers()).toEqual(spread);
  });

  test("hidden elements cannot be reached or clicked", async ({ page }) => {
    await open(page, "focus");
    await node(page, "EG").click();
    await hidden(page, "OG");
    await expect(node(page, "OG")).toHaveAttribute("aria-hidden", "true");
    await expect(node(page, "OG")).toHaveAttribute("tabindex", "-1");
    await expect(node(page, "OG")).toHaveCSS("pointer-events", "none");
  });

  test("without the option the selected floor stays where it is and a second click deselects it", async ({ page }) => {
    await open(page, "floors");
    await expect(node(page, "OG")).toHaveCSS("opacity", "1");
    await node(page, "EG").click();
    await expect(page.locator("detailed-energy-card .path")).toHaveText("Zuhause");
  });
});

test("an invalid configuration shows a readable error", async ({ page }) => {
  await page.goto("/dev/index.html?scenario=invalid");
  await expect(page.locator("detailed-energy-card .error")).toContainText("area_id");
});

test("lines with more power animate faster", async ({ page }) => {
  await open(page, "floors");
  const durations = await page.locator("detailed-energy-card path.line.flowing").evaluateAll((els) =>
    els.map((e) => ({ w: Number(e.getAttribute("stroke-width")), d: parseFloat(getComputedStyle(e).getPropertyValue("--dur")) })),
  );
  expect(durations.length).toBeGreaterThan(3);
  // thicker line = more power = shorter cycle
  const sorted = [...durations].sort((a, b) => a.w - b.w);
  expect(sorted[0].d).toBeGreaterThan(sorted[sorted.length - 1].d);
  expect(new Set(durations.map((x) => x.d)).size).toBeGreaterThan(3);
});

test("clicking the selected floor selects all floors", async ({ page }) => {
  await open(page, "floors");
  await node(page, "EG").click();
  await expect(page.locator("detailed-energy-card .path")).toHaveText("Zuhause");
  await expect(page.locator("detailed-energy-card .pill.selected")).toHaveCount(3);
  await expect(page.locator("detailed-energy-card .circle.room")).toHaveCount(0);
  await expect(page.locator("detailed-energy-card .detail-head")).toContainText("8 Verbraucher");
  await node(page, "OG").click();
  await expect(page.locator("detailed-energy-card .path")).toHaveText("Zuhause › OG");
  await expect(page.locator("detailed-energy-card .pill.selected")).toHaveCount(1);
});

test("clicking the home selects everything again", async ({ page }) => {
  await open(page, "floors");
  await node(page, "OG").click();
  await node(page, "Zuhause").click();
  await expect(page.locator("detailed-energy-card .path")).toHaveText("Zuhause");
  await expect(page.locator("detailed-energy-card .pill.selected")).toHaveCount(3);
  await expect(page.locator("detailed-energy-card .detail-head")).toContainText("8 Verbraucher");
});

test("flat: clicking the home selects all rooms", async ({ page }) => {
  await open(page, "flat");
  await node(page, "Zuhause").click();
  await expect(page.locator("detailed-energy-card .circle.room.selected")).toHaveCount(5);
  await expect(page.locator("detailed-energy-card .path")).toHaveText("Zuhause");
  await node(page, "Bad").click();
  await expect(page.locator("detailed-energy-card .circle.room.selected")).toHaveCount(1);
});

test.describe("consumer list on small screens", () => {
  for (const width of [420, 340, 280]) {
    test(`values stay visible and aligned at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await open(page, "long");
      const card = await page.locator("detailed-energy-card ha-card").boundingBox();
      const vals = await page.locator("detailed-energy-card .row .val").evaluateAll((els) =>
        els.map((e) => {
          const r = e.getBoundingClientRect();
          return { right: r.right, left: r.left, width: r.width };
        }),
      );
      expect(vals.length).toBeGreaterThanOrEqual(3);
      for (const v of vals) {
        expect(v.width).toBeGreaterThan(20);
        expect(v.right).toBeLessThanOrEqual(card!.x + card!.width + 0.5);
      }
      // all values end at the same x, so the numbers stand exactly below each other
      expect(new Set(vals.map((v) => Math.round(v.right))).size).toBe(1);
    });
  }

  test("the bar is shown when there is room and hidden when there is not", async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 900 });
    await open(page, "long");
    await expect(page.locator("detailed-energy-card .row .bar").first()).toBeVisible();
    await page.setViewportSize({ width: 300, height: 900 });
    await expect(page.locator("detailed-energy-card .row .bar").first()).toBeHidden();
    await expect(page.locator("detailed-energy-card .row .val").first()).toBeVisible();
  });

  test("long names are cut off with an ellipsis instead of pushing the values", async ({ page }) => {
    await page.setViewportSize({ width: 340, height: 900 });
    await open(page, "long");
    const cut = await page.locator("detailed-energy-card .row .name").evaluateAll((els) =>
      els.map((e) => e.scrollWidth > e.clientWidth),
    );
    expect(cut.some(Boolean)).toBe(true);
  });
});

test("floors are fully visible when no rooms are shown", async ({ page }) => {
  await open(page, "floors");
  await node(page, "Zuhause").click();
  const scroll = await page.locator("detailed-energy-card .scroll").boundingBox();
  const pills = await page.locator("detailed-energy-card .pill").evaluateAll((els) =>
    els.map((e) => e.getBoundingClientRect().bottom),
  );
  expect(pills).toHaveLength(3);
  for (const bottom of pills) expect(bottom).toBeLessThanOrEqual(scroll!.y + scroll!.height);
});

test("on wide screens the bar uses the free space next to the name", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/dev/index.html?scenario=floors&width=900");
  await expect(page.locator("detailed-energy-card .path")).not.toHaveText("");
  const box = await page.locator("detailed-energy-card .detail").boundingBox();
  const bar = await page.locator("detailed-energy-card .row .bar").first().boundingBox();
  // the bar starts in the left half and stretches over at least 40 % of the list
  expect(bar!.x - box!.x).toBeLessThan(box!.width * 0.5);
  expect(bar!.width).toBeGreaterThan(box!.width * 0.4);
});

test.describe("idle nodes and color thresholds", () => {
  test("consumers without power are faded in the list", async ({ page }) => {
    await open(page, "floors");
    const idle = page.locator("detailed-energy-card .row.idle");
    await expect(idle).toHaveCount(2); // coffee machine and the hallway light (room Flur is off)
    await expect(idle.first().locator(".bar")).toHaveCSS("opacity", "0.45");
    await expect(idle.first().locator(".val")).not.toHaveCSS("color", await page.locator("detailed-energy-card .row:not(.idle) .val").first().evaluate((e) => getComputedStyle(e).color));
    await expect(page.locator("detailed-energy-card .row", { hasText: "Kaffeemaschine" })).toHaveClass(/idle/);
    await expect(page.locator("detailed-energy-card .row", { hasText: "Backofen" })).not.toHaveClass(/idle/);
  });

  test("rooms and floors without power are faded in the diagram", async ({ page }) => {
    await open(page, "floors");
    await expect(node(page, "Flur")).toHaveClass(/idle/);
    await expect(node(page, "Küche")).not.toHaveClass(/idle/);
    await expect(node(page, "EG")).not.toHaveClass(/idle/);
  });

  test("bars in the list take the color of their power range", async ({ page }) => {
    await open(page, "floors");
    const bg = (name: string) =>
      page
        .locator("detailed-energy-card .row", { hasText: name })
        .locator(".bar > div")
        .evaluate((e) => getComputedStyle(e).backgroundColor);
    expect(await bg("Backofen")).toBe("rgb(255, 152, 0)"); // 820 W -> orange
    expect(await bg("Spülmaschine")).toBe("rgb(76, 175, 80)"); // 310 W -> green
  });

  test("higher power ranges also draw thicker bars, not only another color", async ({ page }) => {
    await open(page, "floors");
    const height = (name: string) =>
      page
        .locator("detailed-energy-card .row", { hasText: name })
        .locator(".bar")
        .evaluate((e) => parseFloat(getComputedStyle(e).height));
    expect(await height("Backofen")).toBeGreaterThan(await height("Spülmaschine")); // orange range vs green range
  });

  test("active lines take the color of their power range", async ({ page }) => {
    await open(page, "floors");
    const strokes = await page
      .locator("detailed-energy-card path.line.active")
      .evaluateAll((els) => els.map((e) => getComputedStyle(e).stroke));
    expect(strokes).toContain("rgb(244, 67, 54)"); // PV 3.42 kW -> red
    expect(strokes).toContain("rgb(255, 152, 0)"); // e.g. battery / floor lines in the orange range
  });

  test("without thresholds the normal colors stay", async ({ page }) => {
    await open(page, "many");
    const bg = await page.locator("detailed-energy-card .bar > div").first().evaluate((e) => (e as HTMLElement).style.background);
    expect(bg).toBe("");
  });
});

test("a sensor assigned to two consumers is reported as a configuration error", async ({ page }) => {
  await page.goto("/dev/index.html?scenario=duplicate");
  await expect(page.locator("detailed-energy-card .error")).toContainText("already assigned");
  await expect(page.locator("detailed-energy-card .error")).toContainText("sensor.backofen");
});

test("the card picker suggests a complete starting configuration from the areas of Home Assistant", async ({ page }) => {
  await open(page, "floors");
  const stub = await page.evaluate(() => {
    const card = customElements.get("detailed-energy-card") as unknown as { getStubConfig(h: unknown): unknown };
    const power = { attributes: { device_class: "power" } };
    return card.getStubConfig({
      states: { "sensor.a": power, "sensor.b": power, "sensor.c": power },
      floors: { eg: { floor_id: "eg", level: 0 } },
      areas: { kueche: { area_id: "kueche", floor_id: "eg" } },
    });
  });
  expect(stub).toMatchObject({
    sources: [{ entity: "sensor.a" }],
    floors: [{ floor_id: "eg", rooms: [{ area_id: "kueche", consumers: [{ entity: "sensor.b" }, { entity: "sensor.c" }] }] }],
  });
});

test("line animation pauses while the card is scrolled out of view", async ({ page }) => {
  await open(page, "floors");
  const card = page.locator("detailed-energy-card");
  const line = page.locator("detailed-energy-card path.line.flowing").first();
  await expect(line).toHaveCSS("animation-play-state", "running");
  await page.evaluate(() => {
    const spacer = document.createElement("div");
    spacer.style.height = "5000px";
    document.body.append(spacer);
    window.scrollTo(0, document.body.scrollHeight);
  });
  await expect(card).toHaveClass(/offscreen/);
  await expect(line).toHaveCSS("animation-play-state", "paused");
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(card).not.toHaveClass(/offscreen/);
  await expect(line).toHaveCSS("animation-play-state", "running");
});

test("sources without a name are called after their type in the language of the user", async ({ page }) => {
  await open(page, "floors");
  for (const t of ["PV", "Batterie", "Netz"]) await expect(node(page, t)).toBeVisible();
  await page.goto("/dev/index.html?scenario=floors&lang=en");
  await expect(page.locator("detailed-energy-card .path")).not.toHaveText("");
  for (const t of ["Solar", "Battery", "Grid"]) await expect(node(page, t)).toBeVisible();
  await expect(page.locator("detailed-energy-card .badge")).toContainText("Self-sufficiency");
});
