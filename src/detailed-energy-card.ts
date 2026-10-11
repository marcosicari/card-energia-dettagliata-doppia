import { LitElement, html, nothing, svg, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { cardStyles, colorVars } from "./styles/theme";
import { collectEntityIds, validateConfig, type EnergyCardConfig } from "./model/config";
import { computeModel, type EnergyModel, type RoomNode, type SourceNode } from "./model/compute";
import { formatPower, type StateLike } from "./model/units";
import { powerReader, socReader } from "./model/readers";
import { isIdle, resolveThresholds, thresholdColor, thresholdLevel, thresholdWidth, type ThresholdLevel } from "./model/thresholds";
import { localize, sourceNames, type Key } from "./localize";
import { buildStubConfig, type StubHass } from "./model/stub-config";
import "./editor/card-editor";
import { defineOnce, registerCardOnce } from "./register";
import { RegistrySource, resolveNames, type AreaEntry, type FloorEntry } from "./model/registry";
import { parseSelection, removeLegacyKeys, selectionKey, type Selection } from "./model/selection";
import {
  computeLayout,
  curve,
  roomPath,
  flowDuration,
  strokeWidth,
  FLOOR_H,
  HOME_H,
  SOURCE_H,
  type Layout,
} from "./view/layout";

interface Hass {
  language?: string;
  locale?: { language?: string };
  config?: { location_name?: string };
  areas?: Record<string, AreaEntry | undefined>;
  floors?: Record<string, FloorEntry | undefined>;
  callWS<T>(msg: { type: string }): Promise<T>;
  states: Record<string, StateLike | undefined>;
}

/** More ranges than this do not get any thicker. */
const MAX_LEVEL = 3;

const SOURCE_ICONS: Record<string, string> = {
  solar: "mdi:white-balance-sunny",
  battery: "mdi:battery-high",
  grid: "mdi:transmission-tower",
  generic: "mdi:flash",
};

export class DetailedEnergyCard extends LitElement {
  static styles = cardStyles;

  @state() private _config?: EnergyCardConfig;
  @state() private _error?: string;
  @state() private _width = 0;
  @state() private _sel: Selection = {};

  private _hass?: Hass;
  private _entityIds: string[] = [];
  private _model?: EnergyModel;
  private _ro?: ResizeObserver;
  private _io?: IntersectionObserver;
  private _observed?: Element;
  /** Config with names from the registry; rebuilt only when the config or the registry changes. */
  private _resolved?: { reg: object; cfg: EnergyCardConfig };
  private _registries = new RegistrySource(() => {
    this._recompute();
    this.requestUpdate();
  });

  static getConfigElement(): HTMLElement {
    return document.createElement("detailed-energy-card-editor");
  }

  static getStubConfig(hass?: StubHass): Record<string, unknown> {
    return buildStubConfig(hass);
  }

  setConfig(config: EnergyCardConfig): void {
    try {
      this._config = validateConfig(config);
      this._error = undefined;
      this._entityIds = collectEntityIds(this._config);
      this._thresholds = resolveThresholds(this._config.colors?.thresholds, this._config.colors?.level_thresholds);
      this._resolved = undefined;
      this._sel = this._loadSelection();
    } catch (e) {
      this._error = (e as Error).message;
      this._config = undefined;
    }
    this._recompute();
  }

  set hass(hass: Hass) {
    const old = this._hass;
    this._hass = hass;
    this._registries.ensure(hass);
    // Only re-render when a referenced entity or the floor / area registry changed.
    const registryChanged = !!old && (old.areas !== hass.areas || old.floors !== hass.floors);
    const displayChanged =
      !!old &&
      (old.locale?.language !== hass.locale?.language ||
        old.language !== hass.language ||
        old.config?.location_name !== hass.config?.location_name);
    if (old && !registryChanged && !displayChanged && this._entityIds.every((id) => old.states[id] === hass.states[id])) return;
    this._recompute();
    this.requestUpdate();
  }

  getCardSize(): number {
    return 8;
  }

  getGridOptions() {
    return { columns: 12, rows: "auto", min_columns: 6 };
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._ro = new ResizeObserver(() => {
      const w = this.renderRoot.querySelector<HTMLElement>(".scroll")?.clientWidth ?? 0;
      if (w && Math.abs(w - this._width) > 1) this._width = w;
    });
    // Pause the line animation while the card is not visible; no re-render needed, only a class on the host.
    if (typeof IntersectionObserver !== "undefined") {
      this._io = new IntersectionObserver((entries) => {
        const last = entries[entries.length - 1];
        if (last) this.classList.toggle("offscreen", !last.isIntersecting);
      });
      this._io.observe(this);
    }
  }

  disconnectedCallback(): void {
    this._ro?.disconnect();
    this._io?.disconnect();
    this._io = undefined;
    this.classList.remove("offscreen");
    this._observed = undefined;
    super.disconnectedCallback();
  }

  protected updated(): void {
    const el = this.renderRoot.querySelector(".scroll");
    if (el && el !== this._observed) {
      this._ro?.disconnect();
      this._ro?.observe(el);
      this._observed = el;
    }
  }

  // ---------- state ----------

  private _recompute(): void {
    if (!this._config || !this._hass) return;
    const states = this._hass.states;
    const reg = this._registries.get(this._hass);
    let cfg = this._config;
    if (reg) {
      if (this._resolved?.reg !== reg) this._resolved = { reg, cfg: resolveNames(this._config, reg) };
      cfg = this._resolved.cfg;
    }
    this._model = computeModel(cfg, powerReader(states), socReader(states), sourceNames(this._hass.locale?.language ?? this._hass.language));
  }

  private get _storageKey(): string {
    return selectionKey(this._config);
  }

  private _loadSelection(): Selection {
    if (this._config?.options?.remember_selection === false) return {};
    try {
      removeLegacyKeys(localStorage);
      return parseSelection(localStorage.getItem(this._storageKey));
    } catch {
      return {};
    }
  }

  private _select(sel: Selection): void {
    this._sel = sel;
    if (this._config?.options?.remember_selection === false) return;
    try {
      localStorage.setItem(this._storageKey, JSON.stringify(sel));
    } catch {
      /* storage may be unavailable */
    }
  }

  /** Applies the stored selection: the largest floor by default, all of its rooms unless one is chosen. */
  private _resolve(model: EnergyModel): { floor?: number; rooms: RoomNode[]; room?: number } {
    const largest = <T extends { watts: number }>(list: T[]) =>
      list.reduce((best, x, i) => (x.watts > list[best].watts ? i : best), 0);
    let floor: number | undefined;
    let rooms = model.rooms;
    if (model.floors.length) {
      const i = model.floors.findIndex((f) => f.id === this._sel.floor);
      // no single floor selected: all floors count as selected and the room row is hidden
      floor = this._sel.floor === null ? undefined : i >= 0 ? i : largest(model.floors);
      rooms = floor === undefined ? [] : model.floors[floor].rooms;
    }
    const r = rooms.findIndex((x) => x.id === this._sel.room);
    const room = r >= 0 ? r : undefined;
    return { floor, rooms, room };
  }

  // ---------- helpers ----------

  private _t(key: Key): string {
    return localize(this._hass?.locale?.language ?? this._hass?.language, key);
  }

  private _fmt(watts: number): string {
    const o = this._config?.options;
    return formatPower(watts, o?.unit ?? "W", o?.decimals ?? 2, this._hass?.locale?.language ?? this._hass?.language);
  }

  private _thresholds = resolveThresholds(undefined, undefined);

  private _moreInfo(entityId: string): void {
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  // ---------- render ----------

  protected render(): TemplateResult {
    if (this._error) return html`<ha-card><div class="error">${this._error}</div></ha-card>`;
    const cfg = this._config;
    const model = this._model;
    if (!cfg || !model) return html`<ha-card></ha-card>`;

    const sel = this._resolve(model);
    const layout = computeLayout({
      width: this._width || 320,
      sources: model.sources.length,
      floors: model.floors.length,
      rooms: sel.rooms.length,
      wrap: cfg.options?.wrap_rooms === true,
    });
    const floor = sel.floor !== undefined ? model.floors[sel.floor] : undefined;
    const room = sel.room !== undefined ? sel.rooms[sel.room] : undefined;
    const home = this._hass?.config?.location_name ?? this._t("home");
    const allFloors = model.floors.length > 0 && sel.floor === undefined;
    // No single room selected: all rooms of the visible row count as selected.
    const allRooms = sel.rooms.length > 0 && !room;
    const detailRoom: RoomNode | undefined = allFloors
      ? {
          id: "",
          name: home,
          icon: "mdi:home",
          watts: model.floors.reduce((sum, f) => sum + f.watts, 0),
          consumers: model.floors.flatMap((f) => f.rooms.flatMap((r) => r.consumers)),
        }
      : allRooms
      ? {
          id: floor?.id ?? "",
          name: floor?.name ?? home,
          icon: floor?.icon ?? "mdi:home",
          color: floor?.color,
          watts: sel.rooms.reduce((sum, r) => sum + r.watts, 0),
          consumers: sel.rooms.flatMap((r) => r.consumers),
        }
      : room;
    const path = [home, floor?.name, room?.name].filter(Boolean).join(" › ");

    return html`
      <ha-card style=${colorVars(cfg.colors)}>
        <header>
          <div>
            ${cfg.title ? html`<h2>${cfg.title}</h2>` : nothing}
            <div class="path">${path}</div>
          </div>
          ${model.autarky !== null
            ? html`<div class="badge">${this._t("autarky")} ${Math.round(model.autarky * 100)} %</div>`
            : nothing}
        </header>
        <div class="scroll">
          <div class="graph" style=${styleMap({ width: `${layout.width}px`, height: `${layout.height}px` })}>
            ${this._renderLines(model, layout, sel.floor, sel.room, allRooms, allFloors)}
            ${model.sources.map((s, i) => this._renderSource(s, layout.sourceXs[i]))}
            ${this._renderHome(model, layout, home, allFloors || (!model.floors.length && allRooms))}
            ${model.floors.map((f, i) => this._renderFloor(f.id, f.name, f.watts, f.color, layout.floorXs[i], layout.yFloor, i === sel.floor, allFloors))}
            ${sel.rooms.map((r, i) => this._renderRoom(r, layout.roomXs[i], layout.roomYs[i], i === sel.room, allRooms))}
          </div>
        </div>
        ${this._renderDetail(model, detailRoom)}
      </ha-card>
    `;
  }

  private _renderLines(model: EnergyModel, l: Layout, floorIdx?: number, roomIdx?: number, allRooms = false, allFloors = false): TemplateResult {
    const animate = this._config?.options?.animation !== false;
    const thresholds = this._thresholds;
    // a line belongs to the level of the node it leads to
    const line = (lvl: ThresholdLevel, d: string, watts: number, active: boolean, reverse = false) => {
      const dur = flowDuration(watts);
      // only lines of the selected path take the threshold color, the others stay muted
      const own = thresholds[lvl];
      const color = active && !isIdle(watts) ? thresholdColor(own, watts) : undefined;
      const level = color ? Math.min(thresholdLevel(own, watts), MAX_LEVEL) : 0;
      // a width set on the reached range replaces the width that follows the power
      const width = (color ? thresholdWidth(own, watts) : undefined) ?? strokeWidth(watts) + level * 0.75;
      return svg`<path
        class="line ${active ? "active" : ""} ${dur && animate ? "flowing" : ""} ${reverse ? "reverse" : ""}"
        d=${d}
        stroke-width=${width}
        style=${(dur ? `--dur:${dur}s;` : "") + (color ? `stroke:${color}` : "")}
      />`;
    };
    const parts: TemplateResult[] = [];
    model.sources.forEach((s, i) => {
      parts.push(line("source", curve(l.sourceXs[i], SOURCE_H, l.homeX, l.yHome), s.watts, Math.abs(s.watts) >= 1, s.reverse));
    });
    const homeBottom = l.yHome + HOME_H;
    let roomFromX = l.homeX;
    let roomFromY = homeBottom;
    model.floors.forEach((f, i) => {
      parts.push(line("floor", curve(l.homeX, homeBottom, l.floorXs[i], l.yFloor), f.watts, allFloors || i === floorIdx));
      if (i === floorIdx) {
        roomFromX = l.floorXs[i];
        roomFromY = l.yFloor + FLOOR_H;
      }
    });
    const rooms = floorIdx !== undefined ? model.floors[floorIdx].rooms : model.rooms;
    rooms.forEach((r, i) => {
      parts.push(line("room", roomPath(roomFromX, roomFromY, l.roomXs[i], l.roomYs[i], l.yRoom), r.watts, allRooms || i === roomIdx));
    });
    return html`<svg class="lines" width=${l.width} height=${l.height}>${parts}</svg>`;
  }

  private _renderSource(s: SourceNode, x: number): TemplateResult {
    const suffix =
      s.type === "battery"
        ? s.reverse
          ? ` · ${this._t("charging")}`
          : s.soc !== undefined
            ? ` · ${Math.round(s.soc)} %`
            : ""
        : s.type === "grid"
          ? ` · ${this._t(s.reverse ? "export" : "import")}`
          : s.type === "solar" && s.share > 0
            ? ` · ${Math.round(s.share * 100)} %`
            : "";
    return html`
      <button
        class="node ${s.valid ? "" : "warn"}"
        style=${styleMap({ left: `${x}px`, top: "0px", "--node-color": s.color ?? "" })}
        title=${s.valid ? s.name : `${s.name}: ${this._t("unavailable")}`}
        @click=${() => this._moreInfo(s.entity)}
      >
        <span class="circle source"><ha-icon icon=${s.icon ?? SOURCE_ICONS[s.type]}></ha-icon></span>
        <span class="label">${s.name}${suffix}</span>
        <span class="value">${this._fmt(s.watts)}</span>
      </button>
    `;
  }

  /** Clicking the home selects everything: all floors, or all rooms without floors. */
  private _renderHome(model: EnergyModel, l: Layout, name: string, everything: boolean): TemplateResult {
    return html`
      <button
        class="node"
        style=${styleMap({ left: `${l.homeX}px`, top: `${l.yHome}px` })}
        aria-pressed=${everything}
        title=${name}
        @click=${() => this._select(model.floors.length ? { floor: null } : { room: null })}
      >
        <span class="circle home">
          <ha-icon icon="mdi:home"></ha-icon>
          <span>${this._fmt(model.homeWatts)}</span>
        </span>
      </button>
    `;
  }

  private _renderFloor(id: string, name: string, watts: number, color: string | undefined, x: number, y: number, selected: boolean, allFloors = false): TemplateResult {
    return html`
      <button
        class="node ${isIdle(watts) ? "idle" : ""}"
        style=${styleMap({ left: `${x}px`, top: `${y}px`, "--node-color": color ?? "" })}
        aria-pressed=${selected}
        title=${name}
        @click=${() => this._select(selected ? { floor: null } : { floor: id })}
      >
        <span class="pill ${selected || allFloors ? "selected" : ""}">${name}<small>${this._fmt(watts)}</small></span>
      </button>
    `;
  }

  private _renderRoom(r: RoomNode, x: number, y: number, selected: boolean, allRooms = false): TemplateResult {
    return html`
      <button
        class="node ${isIdle(r.watts) ? "idle" : ""}"
        style=${styleMap({ left: `${x}px`, top: `${y}px`, "--node-color": r.color ?? "" })}
        aria-pressed=${selected}
        title=${r.name}
        @click=${() => this._select({ ...this._sel, room: selected ? null : r.id })}
      >
        <span class="circle room ${selected || allRooms ? "selected" : ""}"><ha-icon icon=${r.icon ?? "mdi:door"}></ha-icon></span>
        <span class="label">${r.name}</span>
        <span class="value">${this._fmt(r.watts)}</span>
      </button>
    `;
  }

  private _renderDetail(model: EnergyModel, room?: RoomNode): TemplateResult {
    if (!room) {
      return html`<div class="detail empty">${this._t("no_rooms")}</div>`;
    }
    const sorted = [...room.consumers].sort((a, b) => b.watts - a.watts);
    const max = Math.max(1, ...sorted.map((c) => c.watts));
    const showUnassigned = this._config?.options?.show_unassigned !== false && model.unassigned >= 1;
    const thresholds = this._thresholds;
    return html`
      <div class="detail">
        <div class="detail-head">
          <span><ha-icon icon=${room.icon ?? "mdi:door"}></ha-icon> <b>${room.name}</b>
            <span class="muted"> · ${this._fmt(room.watts)}</span></span>
          <span class="muted">${room.consumers.length} ${this._t("consumers")}</span>
        </div>
        ${sorted.length === 0 ? html`<div class="empty">${this._t("no_consumers")}</div>` : nothing}
        <div class="list">
        ${sorted.map((c) => {
          const name = c.name ?? this._hass?.states[c.entity]?.attributes.friendly_name ?? c.entity;
          const own = thresholds.consumer;
          const barColor = thresholdColor(own, c.watts);
          const level = barColor ? Math.min(thresholdLevel(own, c.watts), MAX_LEVEL) : 0;
          const barWidth = barColor ? thresholdWidth(own, c.watts) : undefined;
          return html`
            <button class="row ${c.valid ? "" : "warn"} ${c.valid && isIdle(c.watts) ? "idle" : ""}" @click=${() => this._moreInfo(c.entity)}>
              <span class="name">${name}<small>${c.entity}</small></span>
              <span class="bar" style=${styleMap({ "--level": String(level), ...(barWidth !== undefined ? { "--bar-h": `${barWidth}px` } : {}) })}><div style=${styleMap({ width: `${(c.watts / max) * 100}%`, background: barColor })}></div></span>
              <span class="val">${c.valid ? this._fmt(c.watts) : "–"}</span>
            </button>
          `;
        })}
        ${showUnassigned
          ? html`<div class="row" style="cursor:default">
              <span class="name">${this._t("unassigned")}</span><span class="spacer"></span>
              <span class="val">${this._fmt(model.unassigned)}</span>
            </div>`
          : nothing}
        </div>
      </div>
    `;
  }
}

declare global {
  interface Window {
    customCards?: Array<Record<string, unknown>>;
  }
}
defineOnce("detailed-energy-card", DetailedEnergyCard);
window.customCards ??= [];
registerCardOnce(window.customCards, {
  type: "detailed-energy-card",
  name: "Detailed Energy Card",
  description: localize(typeof navigator === "undefined" ? undefined : navigator.language, "picker_description"),
  preview: true,
});
