import { LitElement, html, nothing, svg, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { styleMap } from "lit/directives/style-map.js";
import { cardStyles, colorVars } from "./styles/theme";
import { collectEnergyIds, collectEntityIds, hasEnergy, validateConfig, type EnergyCardConfig } from "./model/config";
import { energyReader, firstWeekdayIndex, loadEnergy, offeredPeriods, type EnergyPeriod } from "./model/energy";
import { computeModel, listedConsumers, type EnergyModel, type RoomNode, type SourceNode } from "./model/compute";
import { formatEnergy, formatPower, type StateLike } from "./model/units";
import { powerReader, socReader } from "./model/readers";
import { elementThresholds, isIdle, resolveThresholds, thresholdColor, thresholdLevel, thresholdWidth, type ThresholdConfig, type ThresholdLevel } from "./model/thresholds";
import { localize, sourceNames, type Key } from "./localize";
import { buildStubConfig, type StubHass } from "./model/stub-config";
import "./editor/card-editor";
import { defineOnce, registerCardOnce } from "./register";
import { RegistrySource, resolveNames, type AreaEntry, type FloorEntry } from "./model/registry";
import { Tween, focusTargets, type Pos } from "./view/focus";
import { parsePlantTab, parseSelection, plantTabKey, removeLegacyKeysOnce, selectionKey, type Selection } from "./model/selection";
import { plantConfigs } from "./model/plants";
import {
  computeLayout,
  curve,
  roomPath,
  fitScale,
  flowDuration,
  strokeWidth,
  FLOOR_H,
  HOME_H,
  SOURCE_H,
  type Layout,
} from "./view/layout";

interface Hass {
  language?: string;
  locale?: { language?: string; first_weekday?: string };
  config?: { location_name?: string; time_zone?: string };
  areas?: Record<string, AreaEntry | undefined>;
  floors?: Record<string, FloorEntry | undefined>;
  callWS<T>(msg: Record<string, unknown>): Promise<T>;
  states: Record<string, StateLike | undefined>;
}

/** More ranges than this do not get any thicker. */
const MAX_LEVEL = 3;
/** Room columns narrower than this get a smaller label font, so that more of the name stays readable. */
const TIGHT_COL_W = 90;
/** How often the energy of the period is asked for again. */
const ENERGY_REFRESH_MS = 5 * 60_000;

/** A room with where it is shown; rooms of a floor that was just left are still drawn while they fade out. */
interface RoomView {
  room: RoomNode;
  p: Pos;
  leaving: boolean;
}

/** Inline opacity of a node that is fading; undefined leaves it to the stylesheet (idle nodes are dimmed there). */
const fade = (o: number, idle: boolean): string | undefined => (o >= 1 ? undefined : String(o * (idle ? 0.45 : 1)));

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
  /** "power": the power now; "energy": the energy of a period (needs energy sensors) */
  @state() private _mode: "power" | "energy" = "power";
  @state() private _period: EnergyPeriod = "today";
  /** watt hours of the period per energy sensor; undefined until the first answer */
  @state() private _energy?: Map<string, number>;
  @state() private _energyState: "idle" | "loading" | "ok" | "error" = "idle";
  private _energyTimer = 0;
  /** when the last answer arrived (ms); 0 = none for the current view */
  private _energyAt = 0;
  private _energyToken = 0;
  /** with `plants`: the cards of the plants (each draws one plant), and the one open in the tabs layout */
  private _plantEls: DetailedEnergyCard[] = [];
  @state() private _plantTab = 0;

  private _hass?: Hass;
  private _entityIds: string[] = [];
  private _model?: EnergyModel;
  private _ro?: ResizeObserver;
  private _io?: IntersectionObserver;
  private _observed?: Element;
  /** slide after a selection change (only with options.focus_selected) */
  private _tween?: Tween;
  private _raf = 0;
  private _lastSelKey?: string;
  /** positions drawn by the current render, computed in `willUpdate` */
  private _frame?: { floorViews: Pos[]; roomViews: RoomView[] };
  /** what the previous render showed, the start of the next slide */
  private _lastShown = new Map<string, Pos>();
  private _lastRooms = new Map<string, RoomNode>();
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
      // first, because with plants this card only arranges them: the energy mode and selection are theirs
      this._syncPlants(this._config);
      this._sel = this._loadSelection();
      this._loadMode();
      this._ensureEnergy();
    } catch (e) {
      this._error = (e as Error).message;
      this._config = undefined;
      this._plantEls = [];
    }
    this._recompute();
  }

  set hass(hass: Hass) {
    const old = this._hass;
    this._hass = hass;
    if (this._plantEls.length) {
      // every plant card looks by itself whether anything it shows has changed
      for (const el of this._plantEls) el.hass = hass;
      return;
    }
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
    this._ensureEnergy();
  }

  getCardSize(): number {
    // plants one below the other are as tall as all of them together
    const stacked = this._plantEls.length > 0 && (this._config?.options?.plants_layout ?? "stack") === "stack";
    return stacked ? 8 * this._plantEls.length : 8;
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
        if (!last) return;
        this.classList.toggle("offscreen", !last.isIntersecting);
        // the timer chain pauses while the card is hidden: catch up when it is seen again
        if (last.isIntersecting) this._refreshEnergy();
      });
      this._io.observe(this);
    }
    // re-attached (moved in the edit mode, view change): the refresh stopped when the card was detached
    this._refreshEnergy();
  }

  disconnectedCallback(): void {
    this._ro?.disconnect();
    this._io?.disconnect();
    this._io = undefined;
    cancelAnimationFrame(this._raf);
    clearTimeout(this._energyTimer);
    this._energyToken++;
    // an answer that is still on its way is dropped (token), so "loading" would never end
    if (this._energyState === "loading") this._energyState = "idle";
    this._tween = undefined;
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
    if (this._plantEls.length) {
      this._model = undefined;
      return;
    }
    const states = this._hass.states;
    const reg = this._registries.get(this._hass);
    let cfg = this._config;
    if (reg) {
      if (this._resolved?.reg !== reg) this._resolved = { reg, cfg: resolveNames(this._config, reg) };
      cfg = this._resolved.cfg;
    }
    const names = sourceNames(this._hass.locale?.language ?? this._hass.language);
    if (this._mode === "energy") {
      // while the first answer is on its way everything counts 0 instead of showing warnings; after an error nothing is known
      const ids = collectEnergyIds(cfg);
      const values = this._energy ?? (this._energyState === "error" ? new Map<string, number>() : new Map(ids.map((id) => [id, 0] as const)));
      this._model = computeModel(cfg, energyReader(values), socReader(states), names, true);
    } else {
      this._model = computeModel(cfg, powerReader(states), socReader(states), names);
    }
  }

  private get _storageKey(): string {
    return selectionKey(this._config);
  }

  private _loadSelection(): Selection {
    if (this._config?.options?.remember_selection === false) return {};
    try {
      removeLegacyKeysOnce(localStorage);
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

  /** Applies the stored selection: the largest floor by default (all floors with focus_selected), all of its rooms unless one is chosen. */
  private _resolve(model: EnergyModel): { floor?: number; rooms: RoomNode[]; room?: number } {
    const largest = <T extends { watts: number }>(list: T[]) =>
      list.reduce((best, x, i) => (x.watts > list[best].watts ? i : best), 0);
    let floor: number | undefined;
    let rooms = model.rooms;
    if (model.floors.length) {
      const i = model.floors.findIndex((f) => f.id === this._sel.floor);
      // no single floor selected: all floors count as selected and the room row is hidden;
      // with focus_selected the card starts like this too, so the first level is fully visible
      const byDefault = this._focus ? undefined : largest(model.floors);
      floor = this._sel.floor === null ? undefined : i >= 0 ? i : byDefault;
      rooms = floor === undefined ? [] : model.floors[floor].rooms;
    }
    const r = rooms.findIndex((x) => x.id === this._sel.room);
    const room = r >= 0 ? r : undefined;
    return { floor, rooms, room };
  }

  // ---------- energy mode ----------

  private get _modeKey(): string {
    return `${this._storageKey}:mode`;
  }

  /** Mode and period: the remembered ones, else the configured mode and the first period offered. */
  private _loadMode(): void {
    const cfg = this._config;
    const periods = offeredPeriods(cfg?.options?.energy_periods);
    let mode: "power" | "energy" = cfg?.options?.mode === "energy" ? "energy" : "power";
    let period: EnergyPeriod = periods[0];
    if (cfg?.options?.remember_selection !== false) {
      try {
        const v = JSON.parse(localStorage.getItem(this._modeKey) ?? "null") as { mode?: unknown; period?: unknown } | null;
        if (v?.mode === "power" || v?.mode === "energy") mode = v.mode;
        if (periods.includes(v?.period as EnergyPeriod)) period = v!.period as EnergyPeriod;
      } catch {
        /* storage may be unavailable or hold something else */
      }
    }
    if (!cfg || !hasEnergy(cfg) || this._plantEls.length) mode = "power";
    this._mode = mode;
    this._period = period;
    this._energy = undefined;
    this._energyState = "idle";
    this._energyAt = 0;
    clearTimeout(this._energyTimer);
    this._energyToken++;
  }

  private _setView(mode: "power" | "energy", period: EnergyPeriod): void {
    const changed = mode !== this._mode || period !== this._period;
    this._mode = mode;
    this._period = period;
    if (this._config?.options?.remember_selection !== false) {
      try {
        localStorage.setItem(this._modeKey, JSON.stringify({ mode, period }));
      } catch {
        /* storage may be unavailable */
      }
    }
    if (!changed) return;
    clearTimeout(this._energyTimer);
    this._energyToken++;
    // the numbers of another period would be wrong for this one
    this._energy = undefined;
    this._energyAt = 0;
    if (mode === "energy") {
      this._energyState = "idle";
      this._ensureEnergy(true);
    }
    this._recompute();
  }

  /** Loads the energy of the period when the energy mode needs it. */
  private _ensureEnergy(force = false): void {
    if (this._mode !== "energy" || !this._config || !this._hass) return;
    if (!force && this._energyState !== "idle") return;
    void this._fetchEnergy();
  }

  /**
   * Brings the energy values up to date after the refresh chain was interrupted (card detached or hidden):
   * loads again when the last answer is old, otherwise waits out the rest of the interval.
   */
  private _refreshEnergy(): void {
    if (this._mode !== "energy" || !this._config || !this._hass || this._energyState === "loading") return;
    const age = Date.now() - this._energyAt;
    if (this._energyState === "ok" && age < ENERGY_REFRESH_MS) {
      clearTimeout(this._energyTimer);
      this._energyTimer = window.setTimeout(() => this._onEnergyTimer(), ENERGY_REFRESH_MS - age);
      return;
    }
    void this._fetchEnergy();
  }

  private _onEnergyTimer(): void {
    // while the card is hidden the chain just ends; the observer starts it again when the card is seen
    if (!this.classList.contains("offscreen")) void this._fetchEnergy();
  }

  private async _fetchEnergy(): Promise<void> {
    const cfg = this._config;
    const hass = this._hass;
    if (!cfg || !hass || this._mode !== "energy") return;
    const token = ++this._energyToken;
    clearTimeout(this._energyTimer);
    // an answer for the period that was shown stays visible while the new one is loading
    if (this._energyState !== "ok") this._energyState = "loading";
    try {
      const values = await loadEnergy(
        hass,
        collectEnergyIds(cfg),
        this._period,
        new Date(),
        hass.config?.time_zone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
        firstWeekdayIndex(hass.locale?.first_weekday, hass.locale?.language ?? hass.language),
      );
      if (token !== this._energyToken) return;
      this._energy = values;
      this._energyAt = Date.now();
      this._energyState = "ok";
    } catch {
      if (token !== this._energyToken) return;
      this._energy = undefined;
      this._energyState = "error";
    }
    this._recompute();
    // the statistics are compiled every few minutes: ask again from time to time
    this._energyTimer = window.setTimeout(() => this._onEnergyTimer(), ENERGY_REFRESH_MS);
  }

  private _renderModeSwitch(cfg: EnergyCardConfig): TemplateResult | typeof nothing {
    if (!hasEnergy(cfg)) return nothing;
    const periods = offeredPeriods(cfg.options?.energy_periods);
    const items: Array<{ mode: "power" | "energy"; period: EnergyPeriod; label: string; on: boolean }> = [
      { mode: "power", period: this._period, label: this._t("mode_now"), on: this._mode === "power" },
      ...periods.map((p) => ({ mode: "energy" as const, period: p, label: this._t(`period_${p}`), on: this._mode === "energy" && this._period === p })),
    ];
    return html`
      <div class="modes" role="group" aria-label=${this._t("period_label")}>
        ${items.map(
          (i) => html`<button class=${i.on ? "on" : ""} aria-pressed=${i.on} @click=${() => this._setView(i.mode, i.period)}>${i.label}</button>`,
        )}
        ${this._mode === "energy" && this._energyState === "loading" ? html`<span class="status">${this._t("energy_loading")}</span>` : nothing}
        ${this._mode === "energy" && this._energyState === "error" ? html`<span class="status warn">${this._t("energy_error")}</span>` : nothing}
      </div>
    `;
  }

  // ---------- plants ----------

  /**
   * With `plants` this card only arranges the plants: every plant is an ordinary card of this same element,
   * given the config of that plant (see model/plants.ts), so a plant behaves exactly like a card of its own.
   * The cards are kept between configs, so an edit of the YAML does not throw their state away.
   */
  private _syncPlants(cfg: EnergyCardConfig): void {
    this._plantEls = plantConfigs(cfg).map((plantCfg, i) => {
      const el = this._plantEls[i] ?? (document.createElement("detailed-energy-card") as DetailedEnergyCard);
      el.toggleAttribute("embedded", true);
      el.setConfig(plantCfg);
      if (this._hass) el.hass = this._hass;
      return el;
    });
    this._plantTab = this._loadPlantTab(cfg, this._plantEls.length);
  }

  private _loadPlantTab(cfg: EnergyCardConfig, count: number): number {
    if (cfg.options?.remember_selection === false) return 0;
    try {
      return parsePlantTab(localStorage.getItem(plantTabKey(cfg)), count);
    } catch {
      return 0;
    }
  }

  private _selectPlant(index: number): void {
    this._plantTab = index;
    if (this._config?.options?.remember_selection === false) return;
    try {
      localStorage.setItem(plantTabKey(this._config), String(index));
    } catch {
      /* storage may be unavailable */
    }
  }

  private _renderPlants(cfg: EnergyCardConfig): TemplateResult {
    const layout = cfg.options?.plants_layout ?? "stack";
    const tab = Math.min(this._plantTab, this._plantEls.length - 1);
    // in the tabs layout only the open plant is in the page; the others are kept for when their tab is chosen
    const shown = layout === "tabs" ? [this._plantEls[tab]] : this._plantEls;
    return html`
      <ha-card style=${colorVars(cfg.colors)}>
        ${cfg.title ? html`<header><h2>${cfg.title}</h2></header>` : nothing}
        ${layout === "tabs"
          ? html`<div class="plant-tabs" role="tablist">
              ${(cfg.plants ?? []).map(
                (p, i) => html`<button role="tab" class=${i === tab ? "on" : ""} aria-selected=${i === tab} @click=${() => this._selectPlant(i)}>${p.name}</button>`,
              )}
            </div>`
          : nothing}
        <div class="plants ${layout}">${shown}</div>
      </ha-card>
    `;
  }

  // ---------- helpers ----------

  private _t(key: Key): string {
    return localize(this._hass?.locale?.language ?? this._hass?.language, key);
  }

  private _fmt(watts: number): string {
    const o = this._config?.options;
    if (this._mode === "energy") return formatEnergy(watts, o?.decimals ?? 1, this._hass?.locale?.language ?? this._hass?.language);
    return formatPower(watts, o?.unit ?? "W", o?.decimals ?? 2, this._hass?.locale?.language ?? this._hass?.language);
  }

  private _thresholds = resolveThresholds(undefined, undefined);

  private get _focus(): boolean {
    return this._config?.options?.focus_selected === true;
  }

  private _startTween(next: Map<string, Pos>, origin: Pos): void {
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tween = new Tween(this._lastShown, next, () => origin, reduced, performance.now());
    this._tween = tween;
    cancelAnimationFrame(this._raf);
    const step = () => {
      this.requestUpdate();
      if (this._tween === tween && !tween.finished(performance.now())) this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }

  private _moreInfo(entityId: string): void {
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  }

  // ---------- render ----------

  /** What the selection and the width of the card make of the diagram: pure, nothing is stored. */
  private _geometry(model: EnergyModel) {
    const cfg = this._config;
    const sel = this._resolve(model);
    const layout = computeLayout({
      width: this._width || 320,
      sources: model.sources.length,
      floors: model.floors.length,
      rooms: sel.rooms.length,
      wrap: cfg?.options?.wrap_rooms === true,
      fit: cfg?.options?.fit_width === true,
    });
    // Positions of the floors and rooms. With options.focus_selected the selected element of a level
    // slides to the middle under its parent and the rest of that level fades out behind it.
    const tg = focusTargets({
      layout,
      floors: model.floors.length,
      selFloor: sel.floor,
      rooms: sel.rooms.length,
      selRoom: sel.room,
      focus: this._focus,
    });
    const targets = new Map<string, Pos>();
    model.floors.forEach((f, i) => targets.set(`f:${f.id}`, tg.floors[i]));
    sel.rooms.forEach((r, i) => targets.set(`r:${r.id}`, tg.rooms[i]));
    const selKey = `${sel.floor ?? ""}|${sel.room ?? ""}`;
    return { sel, layout, tg, targets, selKey };
  }

  /**
   * Where the floors and rooms are drawn now. Runs before every render (and not in `render()`, which only
   * reads the result): a changed selection starts the slide from what the previous frame showed.
   */
  protected willUpdate(): void {
    const model = this._model;
    if (this._error || !this._config || !model) {
      this._frame = undefined;
      return;
    }
    const { sel, layout, tg, targets, selKey } = this._geometry(model);
    if (this._focus && this._lastSelKey !== undefined && selKey !== this._lastSelKey) {
      const parent = sel.floor !== undefined ? tg.floors[sel.floor] : { x: layout.homeX, y: layout.yHome, o: 1 };
      this._startTween(targets, { x: parent.x, y: parent.y + FLOOR_H / 2, o: 0 });
    }
    this._lastSelKey = selKey;
    const now = performance.now();
    if (this._tween?.finished(now)) this._tween = undefined;
    const pos = (id: string): Pos => this._tween?.sample(id, now) ?? targets.get(id) ?? { x: 0, y: 0, o: 0 };
    const floorViews = model.floors.map((f) => pos(`f:${f.id}`));
    sel.rooms.forEach((r) => this._lastRooms.set(r.id, r));
    const roomViews: RoomView[] = sel.rooms.map((r) => ({ room: r, p: pos(`r:${r.id}`), leaving: false }));
    // rooms of a floor that was just left fade out where they were
    for (const id of this._tween?.leaving ?? []) {
      const gone = id.startsWith("r:") ? this._lastRooms.get(id.slice(2)) : undefined;
      if (gone) roomViews.push({ room: gone, p: pos(id), leaving: true });
    }
    this._lastShown = new Map([
      ...model.floors.map((f, i) => [`f:${f.id}`, floorViews[i]] as const),
      ...roomViews.map((v) => [`r:${v.room.id}`, v.p] as const),
    ]);
    this._frame = { floorViews, roomViews };
  }

  protected render(): TemplateResult {
    if (this._error) return html`<ha-card><div class="error">${this._error}</div></ha-card>`;
    const cfg = this._config;
    if (cfg && this._plantEls.length) return this._renderPlants(cfg);
    const model = this._model;
    const frame = this._frame;
    if (!cfg || !model || !frame) return html`<ha-card></ha-card>`;

    const { sel, layout } = this._geometry(model);
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

    const { floorViews, roomViews } = frame;

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
        ${this._renderModeSwitch(cfg)}
        <div class="scroll">
          <div class="graph" style=${styleMap({ width: `${layout.width}px`, height: `${layout.height}px`, "--k": String(cfg.options?.fit_width === true ? fitScale(layout.width, Math.max(model.sources.length, sel.rooms.length, model.floors.length)) : 1) })}>
            ${this._renderLines(model, layout, floorViews, roomViews, sel.floor, sel.room, allRooms, allFloors)}
            ${model.sources.map((s, i) => this._renderSource(s, layout.sourceXs[i]))}
            ${this._renderHome(model, layout, home, allFloors || (!model.floors.length && allRooms))}
            ${model.floors.map((f, i) => this._renderFloor(f.id, f.name, f.watts, f.color, floorViews[i], i === sel.floor, allFloors))}
            ${roomViews.map((v) => this._renderRoom(v.room, v.p, layout.roomColW, !v.leaving && v.room.id === sel.rooms[sel.room ?? -1]?.id, allRooms, v.leaving))}
          </div>
        </div>
        ${this._config?.options?.show_consumers === false ? nothing : this._renderDetail(model, detailRoom)}
      </ha-card>
    `;
  }

  private _renderLines(model: EnergyModel, l: Layout, floorViews: Pos[], roomViews: RoomView[], floorIdx?: number, roomIdx?: number, allRooms = false, allFloors = false): TemplateResult {
    const energy = this._mode === "energy";
    const animate = this._config?.options?.animation !== false && !energy;
    const thresholds = this._thresholds;
    // energy mode: the width shows the share of the consumption of the home (or of all sources), no thresholds
    const shareOf = (v: number, total: number) => 1 + Math.min(1, Math.max(0, total > 0 ? v / total : 0)) * 5;
    const produced = model.sources.reduce((sum, s) => sum + Math.max(0, s.watts), 0);
    // a line belongs to the level of the node it leads to
    const line = (lvl: ThresholdLevel, own: ThresholdConfig[] | undefined, d: string, watts: number, active: boolean, reverse = false, opacity = 1) => {
      const dur = energy ? null : flowDuration(watts);
      // only lines of the selected path take the threshold color, the others stay muted
      const list = elementThresholds(own, thresholds[lvl]);
      const color = !energy && active && !isIdle(watts) ? thresholdColor(list, watts) : undefined;
      const level = color ? Math.min(thresholdLevel(list, watts), MAX_LEVEL) : 0;
      // a width set on the reached range replaces the width that follows the power
      const width = energy ? shareOf(watts, lvl === "source" ? produced : model.homeWatts) : (color ? thresholdWidth(list, watts) : undefined) ?? strokeWidth(watts) + level * 0.75;
      return svg`<path
        class="line ${active ? "active" : ""} ${dur && animate ? "flowing" : ""} ${reverse ? "reverse" : ""}"
        d=${d}
        stroke-width=${width}
        style=${(dur ? `--dur:${dur}s;` : "") + (color ? `stroke:${color};` : "") + (opacity < 1 ? `opacity:${opacity}` : "")}
      />`;
    };
    const parts: TemplateResult[] = [];
    model.sources.forEach((s, i) => {
      parts.push(line("source", s.thresholds, curve(l.sourceXs[i], SOURCE_H, l.homeX, l.yHome), s.watts, Math.abs(s.watts) >= 1, s.reverse));
    });
    const homeBottom = l.yHome + HOME_H;
    let roomFromX = l.homeX;
    let roomFromY = homeBottom;
    model.floors.forEach((f, i) => {
      const p = floorViews[i];
      parts.push(line("floor", f.thresholds, curve(l.homeX, homeBottom, p.x, p.y), f.watts, allFloors || i === floorIdx, false, p.o));
      if (i === floorIdx) {
        roomFromX = p.x;
        roomFromY = p.y + FLOOR_H;
      }
    });
    roomViews
      .filter((v) => !v.leaving)
      .forEach(({ room: r, p }, i) => {
        parts.push(line("room", r.thresholds, roomPath(roomFromX, roomFromY, p.x, p.y, l.yRoom), r.watts, allRooms || i === roomIdx, false, p.o));
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
        title=${s.valid ? s.name : `${s.name}: ${this._t(s.noEnergy ? "no_energy" : "unavailable")}`}
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

  private _renderFloor(id: string, name: string, watts: number, color: string | undefined, p: Pos, selected: boolean, allFloors = false): TemplateResult {
    return html`
      <button
        class="node ${isIdle(watts) ? "idle" : ""} ${p.o < 0.5 ? "ghost" : ""}"
        style=${styleMap({ left: `${p.x}px`, top: `${p.y}px`, opacity: fade(p.o, isIdle(watts)), "--node-color": color ?? "" })}
        aria-pressed=${selected}
        aria-hidden=${p.o < 0.5 ? "true" : nothing}
        tabindex=${p.o < 0.5 ? "-1" : nothing}
        title=${name}
        @click=${() => this._select(selected && !this._focus ? { floor: null } : { floor: id })}
      >
        <span class="pill ${selected || allFloors ? "selected" : ""}">${name}<small>${this._fmt(watts)}</small></span>
      </button>
    `;
  }

  private _renderRoom(r: RoomNode, p: Pos, colW: number, selected: boolean, allRooms = false, leaving = false): TemplateResult {
    return html`
      <button
        class="node ${isIdle(r.watts) ? "idle" : ""} ${colW < TIGHT_COL_W ? "tight" : ""} ${p.o < 0.5 || leaving ? "ghost" : ""}"
        style=${styleMap({ left: `${p.x}px`, top: `${p.y}px`, width: `${Math.max(0, colW - 4)}px`, opacity: fade(p.o, isIdle(r.watts)), "--node-color": r.color ?? "" })}
        aria-pressed=${selected}
        aria-hidden=${p.o < 0.5 || leaving ? "true" : nothing}
        tabindex=${p.o < 0.5 || leaving ? "-1" : nothing}
        title=${r.name}
        @click=${() => this._select({ ...this._sel, room: selected && !this._focus ? null : r.id })}
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
    const onlyActive = this._config?.options?.only_active_consumers === true;
    const sorted = [...listedConsumers(room.consumers, onlyActive, this._config?.options?.active_min_watts)].sort((a, b) => b.watts - a.watts);
    const max = Math.max(1, ...sorted.map((c) => c.watts));
    const showUnassigned = this._config?.options?.show_unassigned !== false && model.unassigned >= 1;
    const thresholds = this._thresholds;
    return html`
      <div class="detail">
        <div class="detail-head">
          <span><ha-icon icon=${room.icon ?? "mdi:door"}></ha-icon> <b>${room.name}</b>
            <span class="muted"> · ${this._fmt(room.watts)}</span></span>
          <span class="muted">${onlyActive ? `${sorted.length} / ${room.consumers.length}` : room.consumers.length} ${this._t("consumers")}</span>
        </div>
        ${sorted.length === 0 ? html`<div class="empty">${this._t(room.consumers.length === 0 ? "no_consumers" : "no_active_consumers")}</div>` : nothing}
        <div class="list">
        ${sorted.map((c) => {
          const name = c.name ?? this._hass?.states[c.entity]?.attributes.friendly_name ?? c.entity;
          const list = elementThresholds(c.thresholds, thresholds.consumer);
          const barColor = this._mode === "energy" ? undefined : thresholdColor(list, c.watts);
          const level = barColor ? Math.min(thresholdLevel(list, c.watts), MAX_LEVEL) : 0;
          const barWidth = barColor ? thresholdWidth(list, c.watts) : undefined;
          return html`
            <button class="row ${c.valid ? "" : "warn"} ${c.valid && isIdle(c.watts) ? "idle" : ""}" @click=${() => this._moreInfo(c.entity)}>
              <span class="name">${name}<small>${c.noEnergy ? this._t("no_energy") : c.entity}</small></span>
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
