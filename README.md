<img src="https://raw.githubusercontent.com/stacknoise/detailed-energy-card/main/docs/icon.png" alt="Detailed Energy Card icon" width="96" align="right">

# Detailed Energy Card

Home Assistant Lovelace card showing the power flow from sources (PV, battery, grid) through the home, optional floors and rooms down to individual consumers. See [Entwicklungskonzept.md](Entwicklungskonzept.md) for the full concept and roadmap.

Status: **1.1.1** (see the [changelog](CHANGELOG.md)). Configure it in the visual editor (German and English) or in YAML.

## Preview

Home → floor → room → consumers. Click a floor to show its rooms (all of them are selected), click a room to list just its consumers. Click the selected room again to see all rooms of the floor together, click the selected floor again (or the home) to select all floors and list every consumer.

| With floors | Without floors |
| --- | --- |
| ![Card with floors](https://raw.githubusercontent.com/stacknoise/detailed-energy-card/main/docs/screenshots/card-with-floors.png) | ![Card without floors](https://raw.githubusercontent.com/stacknoise/detailed-energy-card/main/docs/screenshots/card-without-floors.png) |

| All rooms of a floor selected | Many rooms wrapped into two rows |
| --- | --- |
| ![All rooms selected](https://raw.githubusercontent.com/stacknoise/detailed-energy-card/main/docs/screenshots/card-all-rooms.png) | ![Many rooms wrapped](https://raw.githubusercontent.com/stacknoise/detailed-energy-card/main/docs/screenshots/card-many-rooms-wrapped.png) |

| Thresholds per level | Energy mode |
| --- | --- |
| ![Card with thresholds per level](https://raw.githubusercontent.com/stacknoise/detailed-energy-card/main/docs/screenshots/card-thresholds.png) | ![Card in the energy mode](https://raw.githubusercontent.com/stacknoise/detailed-energy-card/main/docs/screenshots/card-energy.png) |

Thresholds can differ per level, and a single element can have its own list: here the floor and room lines have their own limits and widths, and the oven (green until 1 kW) has its own thresholds instead of the consumer level's. The energy mode shows how much each part used today, this week or this month; the lines show the share of the consumption, and the coffee machine has no energy sensor.

The card screenshots are rendered from mock data with `npm run screenshots`.

### Visual editor

Everything can be configured without YAML. Floors and rooms are picked from the floors and areas of your Home Assistant; the editor has a German and an English UI.

| General and options | Thresholds per level |
| --- | --- |
| ![Editor: general](https://raw.githubusercontent.com/stacknoise/detailed-energy-card/main/docs/screenshots/editor-general.png) | ![Editor: thresholds](https://raw.githubusercontent.com/stacknoise/detailed-energy-card/main/docs/screenshots/editor-thresholds.png) |

| Energy sensors | Structure with energy sensors |
| --- | --- |
| ![Editor: energy sensors](https://raw.githubusercontent.com/stacknoise/detailed-energy-card/main/docs/screenshots/editor-energy.png) | ![Editor: structure](https://raw.githubusercontent.com/stacknoise/detailed-energy-card/main/docs/screenshots/editor-structure.png) |

The editor screenshots are rendered from demo data with `npm run screenshots`. The form fields are drawn by a stand-in for Home Assistant's form (`dev/ha-form-stub.js`), so they look like the real ones but are not taken in a real Home Assistant.

## Install (HACS)

The card is part of the HACS default store, so no custom repository is needed.

[![Open your Home Assistant instance and open this repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=stacknoise&repository=detailed-energy-card&category=plugin)

Click the button above to open the card in HACS on your Home Assistant instance, or find it yourself:

1. Open HACS and search for *Detailed Energy Card*.
2. Open the entry and click **Download**.
3. Reload the browser. HACS registers the resource `/hacsfiles/detailed-energy-card/detailed-energy-card.js` automatically.
4. Add the card to a dashboard: **Add card → Detailed Energy Card**, or use `type: custom:detailed-energy-card` in YAML.

## Example

```yaml
type: custom:detailed-energy-card
title: Energiefluss
home:
  total_entity: sensor.hausverbrauch_power
sources:
  - { entity: sensor.pv_leistung, type: solar, name: PV }
  - { entity: sensor.akku_leistung, type: battery, soc_entity: sensor.akku_soc }
  - { entity: sensor.netz_leistung, type: grid }
floors:
  - floor_id: erdgeschoss   # a floor from Home Assistant
    rooms:
      - area_id: kueche   # an area from Home Assistant
        consumers:
          - entity: sensor.backofen_power
            name: Backofen
```

The *Self-sufficiency* badge (share of the consumption not drawn from the grid) needs a source of type `grid`; without one, or while a grid sensor is unavailable, the badge is hidden. Floors and rooms are not free text: they are picked from the floors and areas that already exist in Home Assistant (`floor_id`, `area_id`); names and icons come from there, and the home name is your instance's location name. Options: `options.unit` (`W`, `kW`, `auto`; default `W`), `options.decimals` (0–20, for kW values), `options.animation`, `options.show_unassigned`, `options.show_consumers` (default `true`; `false` hides the list of consumers under the diagram), `options.only_active_consumers` (default `false`; list only consumers that draw 1 W or more, sensors that cannot be read stay listed as warnings), `options.remember_selection` (with `options.storage_id`, a short text, you tell two cards with the same floors and rooms apart, for example a power and an energy view; otherwise they share the selection and the view) and `options.focus_selected` (the selected floor or room slides to the middle under its parent and the others of its level fade out; a click on an element always shows its children, so the home brings all floors back, default off) and `options.wrap_rooms` (wrap more than 6 rooms into two rows instead of scrolling, but only when a single row would be too narrow: less than 80 px per room). A sensor can be assigned to one consumer only (the editor hides sensors that are already taken; the same sensor twice in YAML is a configuration error). Use either `floors` or `rooms` on the top level.

**Negative values:** a consumer that reports a negative value (for example a bidirectional meter) counts as 0 W; only sources can be negative (battery charging, grid feed-in), solar and generic sources are clamped at 0. If a consumer feeds back and you want to see it, add that sensor as a source instead.

**Energy mode (kWh):** besides the power now the card can show how much energy each part used today, this week or this month. Give sources and consumers an `energy_entity` (a `sensor.*` energy counter with `device_class: energy`, in Wh, kWh or MWh) next to their power `entity`, and optionally `home.total_energy_entity` for "Unassigned" and the self-sufficiency badge. A switch *Now | Today | Week | Month* appears in the card once one element has an energy sensor. The values come from the long-term statistics of Home Assistant (the sensors need a `state_class` of `total` or `total_increasing`, and the recorder must keep them); the card needs no `utility_meter` helpers. Day, week and month start at midnight in the time zone of Home Assistant, the week on the first weekday of your locale. Lines show the share of the home's consumption instead of a flow, there are no thresholds and no animation in this mode. An element without `energy_entity` is shown as unavailable ("No energy sensor configured"). Feed-in and battery charging are not shown in the energy mode, because an energy counter only counts in one direction: enter the import counter of the grid, not the export counter. Options: `options.mode` (`power` or `energy`, what the card shows when it loads) and `options.energy_periods` (a list of `today`, `week`, `month` the switch offers; default all).

```yaml
home:
  total_entity: sensor.house_power
  total_energy_entity: sensor.house_energy
sources:
  - { entity: sensor.pv_power, energy_entity: sensor.pv_energy, type: solar }
  - { entity: sensor.grid_power, energy_entity: sensor.grid_import_energy, type: grid }
floors:
  - floor_id: ground_floor
    rooms:
      - area_id: kitchen
        consumers:
          - { entity: sensor.oven_power, energy_entity: sensor.oven_energy }
options:
  mode: energy
  energy_periods: [today, week]
```

**Idle and thresholds:** consumers that draw no power (under 1 W) are shown faded in the list, and rooms and floors without consumption are faded in the diagram. To color lines and list bars by power, add thresholds (in watts); from each `from` value upwards the color applies, below the first one the normal color is used:

```yaml
colors:
  thresholds:
    - { from: 0, color: "#4caf50" }
    - { from: 500, color: "#ff9800" }
    - { from: 2000, color: "#f44336" }
```

A range can also set the line width (`width`, 0.5 to 12 px). It replaces the width that follows the power; without `width` the automatic width applies. Each level of the diagram (`source`, `floor`, `room`, `consumer`) can have its own thresholds, because a floor draws far more power than a single device. A level without its own list uses `colors.thresholds`. A line belongs to the level of the node it leads to; `consumer` is the bar in the list:

```yaml
colors:
  thresholds:                      # used by every level without its own list
    - { from: 0, color: "#4caf50", width: 1.5 }
    - { from: 500, color: "#ff9800", width: 3 }
    - { from: 2000, color: "#f44336", width: 5 }
  level_thresholds:
    floor:
      - { from: 0, color: "#4caf50", width: 2 }
      - { from: 1500, color: "#ff9800", width: 3.5 }
      - { from: 4000, color: "#f44336", width: 5.5 }
    consumer:
      - { from: 0, color: "#4caf50" }
      - { from: 300, color: "#ff9800" }
      - { from: 1500, color: "#f44336" }
```

A source, floor, room or consumer can also have its own `thresholds` list, which replaces the list of its level for that element only (for example a heat pump that normally draws 2 kW and should only turn red above 4 kW). The order of precedence is: element, level, `colors.thresholds`:

```yaml
rooms:
  - area_id: technikraum
    consumers:
      - entity: sensor.waermepumpe_power
        thresholds:
          - { from: 0, color: "#4caf50" }
          - { from: 4000, color: "#f44336" }
```

In the visual editor they are under *Colors → Thresholds* (with a traffic-light preset, a level selector and a "scale limits" button that multiplies the limits of the shown list by a factor); an element's own thresholds are in its entry under *Own thresholds*. Every color field takes a single CSS color: hex (`#9184d9`), `rgb()`/`hsl()`, a named color (`orange`) or a theme variable (`var(--primary-color)`); anything else is a configuration error. Only `sensor.*` power entities (W / kW / MW) are supported; a sensor with another unit (for example kWh or V) is not counted as watts and shows a warning on its node. A battery state-of-charge sensor (`soc_entity`) must report `%`. All options are documented in the concept, section 3.

## Several plants

One card can show several separate plants, for example a house and an annex with their own solar, battery and consumers, plus one shared grid:

```yaml
type: custom:detailed-energy-card
title: Plants
sources:            # shared: appears in every plant
  - { entity: sensor.grid, type: grid }
options:
  plants_layout: stack   # stack | row | tabs
plants:
  - name: House
    home: { total_entity: sensor.house_total }
    sources:
      - { entity: sensor.pv_house, type: solar }
      - { entity: sensor.battery_house, type: battery, soc_entity: sensor.battery_house_soc }
    rooms:
      - { area_id: kitchen, consumers: [{ entity: sensor.oven }] }
  - name: Annex
    sources:
      - { entity: sensor.pv_annex, type: solar }
    rooms:
      - { area_id: garage, consumers: [{ entity: sensor.wallbox }] }
```

Put `home`, `floors` and `rooms` inside each plant, not on the top level. A consumer sensor may belong to one plant only. Limits: the shared grid is drawn in each plant, each plant has its own energy switch, and the visual editor cannot edit `plants` (YAML only).

## Development

```bash
npm install
npm test            # unit tests (Vitest)
npm run build       # dist/detailed-energy-card.js
npm run test:e2e    # browser tests (Playwright) against dev/index.html
npm run screenshots # re-render docs/screenshots/*.png
npm run icon        # re-render docs/icon.png and docs/social-preview.png
```

Releases: raise `version` in `package.json`, merge, then push the tag `v<version>`; the release workflow refuses a tag that does not match. Add the changes to [CHANGELOG.md](CHANGELOG.md) first.

Texts: card and editor look up their texts by key in `src/localize/index.ts` and `src/localize/editor.ts`. Each file has a German table `de` and an English table `en: typeof de`, so a new text needs a key in both, and the type check fails when one is missing. Do not write German text directly in `src/editor/`; a test checks that.

`npx vite` serves `dev/index.html`, a mock-data preview. Pick a scenario with `?scenario=floors|flat|many|wrap|invalid`.

Locally the browser tests use the installed Microsoft Edge; in CI they use Chromium (`npx playwright install chromium`).
