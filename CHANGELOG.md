# Changelog

## Unreleased

### Added

- `options.focus_selected` (default off): the selected floor or room slides to the middle under its parent while the other elements of its level fade out behind it. Its children are spread around the new middle as usual. A click on an element always shows its children: the home shows all floors, a floor (also the selected one) shows all its rooms. Hidden elements cannot be clicked or reached with the keyboard. With reduced motion nothing slides, elements only fade.
- Editor: a switch for it under *General*.

## 0.9.3

### Fixed

- `wrap_rooms` wraps into two rows only when a single row would be too narrow (less than 80 px per room). On a wide card, all rooms stay on one row.
- Room names no longer run into each other on small displays with many rooms (with or without wrapping). A room's name is cut with an ellipsis at the width of its column (the full name is the tooltip), and narrow columns use a smaller label font.

## 0.9.2

### Changed

- Editor: the thresholds section is collapsible and starts closed, with the number of ranges as a summary. Each range is collapsible too and shows its color, limit and line width in its header. A new range opens right away.

## 0.9.1

### Added

- Thresholds on single elements: a source, floor, room or consumer can have its own `thresholds` list that replaces the list of its level for that element only. Precedence: element, level, `colors.thresholds`.
- Editor: every source, floor, room and consumer has a collapsible *Own thresholds* section. Every threshold list also has a "scale limits" button (factor field) that multiplies all limits of the shown list, and a button to copy the parent list.

## 0.9.0

### Added

- A threshold range can set the line width with `width` (0.5 to 12 px). It replaces the width that follows the power; the list bar takes it as its height.
- Thresholds per level: `colors.level_thresholds` takes own lists for `source`, `floor`, `room` and `consumer`. A level without its own list uses `colors.thresholds`.
- Editor: *Colors → Thresholds* has a level selector, a width field per range, traffic-light defaults per level, a button to copy the shared list, and a warning when a level lower in the graph has higher limits than the one above.

## 0.8.1

### Changed

- Sources without a name are called PV / Batterie / Netz / Quelle in German and Solar / Battery / Grid / Source otherwise, following the language of the user. The suggested starting configuration no longer writes the German name "Netz" and titles the card in the user's language; the card picker description is localized too.
- Power ranges (thresholds) are no longer shown by color alone: higher ranges also draw thicker lines and list bars.
- Consumers without power in the list are faded through a muted text color and a lighter bar instead of opacity, so their text keeps a readable contrast (Lighthouse accessibility score 100 in the dev preview).
- Editor: all icon buttons, color swatches and the color picker have an accessible name (`aria-label`) for screen readers.
- README: explains how negative consumer values are handled.

## 0.8.0

### Fixed

- A changed language or home name (`location_name`) now updates the card without a sensor change.
- Loading the card script twice (for example as two dashboard resources) no longer throws "already defined" and no longer adds a second entry to the card picker.

### Changed

- The visual editor no longer renders again for every state change in Home Assistant; it updates only when a sensor used in the card, the language, the theme or the floors and areas change.
- The flow-line animation pauses while the card is scrolled out of view, which saves CPU on long dashboards.
- **Upgrade note:** the remembered floor and room selection is reset once. It is now stored by `floor_id` / `area_id` instead of by name, so it survives renaming a floor or area and changing colors, names or consumers. Old storage entries are removed.
- A damaged stored selection is ignored instead of causing errors.

## 0.7.2

### Fixed

- The self-sufficiency (autarky) badge is hidden when no grid source is configured or the grid sensor is unreadable, instead of showing a misleading 100 %.
- Sensors with a wrong unit (for example kWh or V) are no longer counted as watts. The card shows a warning for them.
- The editor's floor switch no longer drops rooms without a floor silently. It stays disabled until floors and areas are loaded, shows which rooms were hidden, and switching floors off restores them.
- Floors and areas are read from `hass.areas` / `hass.floors` when available. The WebSocket fallback retries at most every 30 seconds after a failure.

### Changed

- The config is validated up front with path-specific error messages:
  - `decimals` must be an integer from 0 to 20.
  - Option types (`unit`, booleans, color preset) are checked.
  - Colors must be a single CSS color (hex, `rgb()`/`hsl()`, named color, `var(--x)` or `theme`). Values that could inject extra CSS are rejected.

### Internal

- Updated to Vite 8, Vitest 5 and TypeScript 7.
- CI and release workflows hardened: pinned action versions, least-privilege permissions, build provenance attestation.
- Dependabot added for npm and GitHub Actions.
