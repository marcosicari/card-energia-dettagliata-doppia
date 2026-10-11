import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { collectEntityIds, type EnergyCardConfig, type FloorConfig, type RoomConfig, type SourceConfig } from "../model/config";
import {
  consumerEntitiesExcept,
  findDuplicates,
  getIn,
  getPath,
  moveItem,
  removeItem,
  reorder,
  roomsWithoutFloor,
  setPath,
  toggleFloors,
  updateIn,
  type Pointer,
} from "./config-utils";
import {
  COLORS,
  COLOR_KEYS,
  THRESHOLD,
  PALETTE,
  consumerFields,
  GENERAL,
  HOME,
  SOURCE,
  floorFields,
  labelFor,
  roomFields,
  toSchema,
  type Choice,
  type Field,
} from "./schema";
import { RegistrySource, type Registries, type RegistryHass } from "../model/registry";
import type { StateLike } from "../model/units";
import {
  DEFAULT_LEVEL_THRESHOLDS,
  DEFAULT_THRESHOLDS,
  THRESHOLD_LEVELS,
  duplicateThresholds,
  type ThresholdConfig,
  type ThresholdLevel,
} from "../model/thresholds";
import { colorError, contrastWarning, fieldErrors, sumConflict } from "./validation";
import { defineOnce } from "../register";
import { hassChangedForEditor, type EditorHass } from "./hass-change";
import { makeTr, type Tr } from "../localize/editor";

interface Hass {
  states: Record<string, unknown>;
  callWS<T>(msg: { type: string }): Promise<T>;
  [k: string]: unknown;
}

const LEVEL_LABEL: Record<"all" | ThresholdLevel, string> = {
  all: "Alle",
  source: "Quellen",
  floor: "Etagen",
  room: "Räume",
  consumer: "Verbraucher",
};

/** Visual editor: every config option has a field (see schema.ts and the coverage test). */
export class DetailedEnergyCardEditor extends LitElement {
  @property({ attribute: false }) hass?: Hass;
  @state() private _config?: EnergyCardConfig;
  /** open state of collapsible tree/source items, keyed by pointer */
  @state() private _open = new Set<string>();

  /** short message when an edit was refused, cleared by the next accepted change */
  @state() private _notice?: string;
  /** which thresholds the editor shows: the shared list or one level */
  @state() private _thrLevel: "all" | ThresholdLevel = "all";
  /** factor of the "scale limits" button */
  @state() private _scale = 0.5;
  private _registries = new RegistrySource(() => this.requestUpdate());
  /** rooms left out when floors were switched on; switching floors off puts them back */
  private _leftOut: RoomConfig[] = [];

  setConfig(config: EnergyCardConfig): void {
    this._config = config;
  }

  private _ids?: { cfg: EnergyCardConfig; ids: string[] };

  /** Entity ids used by the config; recomputed only when the config object changes. */
  private get _entityIds(): string[] {
    const cfg = this._config;
    if (!cfg) return [];
    if (this._ids?.cfg !== cfg) {
      let ids: string[] = [];
      try {
        ids = collectEntityIds(cfg);
      } catch {
        /* a half-edited config: render on every change until it is usable */
        return [];
      }
      this._ids = { cfg, ids };
    }
    return this._ids.ids;
  }

  /** A new `hass` arrives with every state change of the instance; skip those that do not concern the editor. */
  protected shouldUpdate(changed: PropertyValues): boolean {
    if (changed.size !== 1 || !changed.has("hass")) return true;
    return hassChangedForEditor(changed.get("hass") as EditorHass | undefined, this.hass as EditorHass | undefined, this._entityIds);
  }

  protected willUpdate(): void {
    this._registries.ensure(this.hass as RegistryHass | undefined);
  }

  /** Floors and areas of Home Assistant; undefined until they are available. */
  private get _reg(): Registries | undefined {
    return this._registries.get(this.hass as RegistryHass | undefined);
  }

  // ---------- Home Assistant floors and areas (the only allowed choices) ----------

  private _usedFloorIds(): string[] {
    return (this._config?.floors ?? []).map((f) => f.floor_id);
  }

  private _usedAreaIds(): string[] {
    const c = this._config;
    return [...(c?.rooms ?? []), ...(c?.floors ?? []).flatMap((f) => f.rooms ?? [])].map((r) => r.area_id);
  }

  private _floorChoices(current: string): Choice[] {
    const used = this._usedFloorIds();
    return (this._reg?.floors ?? [])
      .filter((f) => f.floor_id === current || !used.includes(f.floor_id))
      .map((f) => ({ value: f.floor_id, label: f.name }));
  }

  /** Areas that may still be added to a list; on a floor only that floor's areas. */
  private _areaOptions(floorId: string | undefined, current = ""): Choice[] {
    const used = this._usedAreaIds();
    return (this._reg?.areas ?? [])
      .filter(
        (a) => (floorId === undefined || a.floor_id === floorId) && (a.area_id === current || !used.includes(a.area_id)),
      )
      .map((a) => ({ value: a.area_id, label: a.name }));
  }

  private get _tr(): Tr {
    const h = this.hass as { locale?: { language?: string }; language?: string } | undefined;
    return makeTr(h?.locale?.language ?? h?.language);
  }

  private _floorName = (id: string) => this._reg?.floors.find((f) => f.floor_id === id)?.name ?? id;
  private _areaName = (id: string) => this._reg?.areas.find((a) => a.area_id === id)?.name ?? id;

  static styles = css`
    :host {
      display: block;
    }
    section {
      border: 1px solid var(--divider-color, #3f424d);
      border-radius: 8px;
      margin-bottom: 12px;
      padding: 4px 12px 12px;
    }
    h3 {
      font-size: 1em;
      margin: 12px 0 8px;
    }
    .item {
      border: 1px solid var(--divider-color, #3f424d);
      border-radius: 8px;
      margin: 8px 0;
      padding: 0 8px;
    }
    .item.nested {
      margin-left: 12px;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 6px 0;
    }
    .head .title {
      flex: 1;
      background: none;
      border: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
      padding: 4px 0;
    }
    .head .title small {
      color: var(--secondary-text-color);
      margin-left: 8px;
    }
    button.icon {
      background: none;
      border: none;
      color: var(--secondary-text-color);
      cursor: pointer;
      font-size: 1.1em;
      padding: 2px 6px;
    }
    button.icon:disabled {
      opacity: 0.3;
      cursor: default;
    }
    .levels {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    .levels button.add {
      margin: 4px 0;
    }
    .levels button.add.on {
      background: var(--primary-color);
      border-style: solid;
      color: var(--text-primary-color, #fff);
    }
    .own-thresholds {
      margin: 4px 0 8px;
    }
    .scale {
      align-items: center;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .scale input {
      width: 5em;
    }
    button.add {
      background: none;
      border: 1px dashed var(--divider-color, #3f424d);
      border-radius: 8px;
      color: var(--primary-color);
      cursor: pointer;
      font: inherit;
      margin: 8px 0;
      padding: 6px 12px;
    }
    .warn {
      color: var(--warning-color, #ffa600);
      font-size: 0.9em;
      margin: 4px 0;
    }
    ha-form {
      display: block;
    }
    .handle {
      cursor: grab;
      color: var(--secondary-text-color);
      padding: 4px 6px;
      user-select: none;
    }
    .color {
      margin: 12px 0;
    }
    .color label {
      display: block;
      margin-bottom: 6px;
    }
    h4 {
      font-size: 0.95em;
      margin: 16px 0 4px;
    }
    .hint {
      color: var(--secondary-text-color);
      font-size: 0.85em;
      margin-bottom: 8px;
    }
    .swatches,
    .inputs {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .swatch {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      border: 2px solid var(--divider-color, #3f424d);
      cursor: pointer;
      padding: 0;
      color: var(--secondary-text-color);
      font-size: 0.75em;
    }
    .swatch.theme {
      background: none;
    }
    .swatch.on {
      border-color: var(--primary-text-color, #fff);
      box-shadow: 0 0 0 2px var(--primary-color, #9184d9);
    }
    .color input[type="text"] {
      background: none;
      border: 1px solid var(--divider-color, #3f424d);
      border-radius: 6px;
      color: inherit;
      font: inherit;
      padding: 6px 8px;
    }
    .color input[type="color"] {
      border: none;
      background: none;
      height: 32px;
      width: 40px;
      padding: 0;
    }
  `;

  // ---------- config mutation ----------

  private _emit(config: EnergyCardConfig): void {
    this._config = config;
    this._notice = undefined;
    this.dispatchEvent(new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true }));
  }

  private _update(ptr: Pointer, fn: (v: any) => any): void {
    if (this._config) this._emit(updateIn(this._config, ptr, fn));
  }

  /** ha-form reports the whole flat data object; apply only the changed fields. */
  private _onForm(ptr: Pointer, fields: Field[], ev: CustomEvent): void {
    ev.stopPropagation();
    const data = ev.detail.value as Record<string, unknown>;
    // A sensor may belong to one consumer only; the picker hides taken ones, this catches the rest.
    if (ptr.includes("consumers") && typeof data.entity === "string" && data.entity) {
      if (consumerEntitiesExcept(this._config, ptr).includes(data.entity)) {
        this._notice = this._tr("Dieser Sensor ist bereits einem Verbraucher zugewiesen.");
        return;
      }
    }
    this._update(ptr, (obj: object) => {
      let next = obj ?? {};
      for (const f of fields.filter((x) => x.kind !== "color")) {
        const current = getPath(next, f.path) ?? f.default;
        if (!(f.path in data) && current === undefined) continue;
        if (data[f.path] !== current) next = setPath(next, f.path, data[f.path]);
      }
      // Choosing a non-custom preset drops the individual colors, so nothing hidden keeps applying.
      const preset = getPath(next, "colors.preset");
      if (preset !== getPath(obj, "colors.preset") && preset !== "custom") {
        for (const k of COLOR_KEYS) next = setPath(next, `colors.${k}`, undefined);
      }
      return next;
    });
  }

  /**
   * Floors on: rooms whose area has no floor cannot be shown, so say which ones and keep them
   * until floors are switched off again. Floors need the area registry to group the rooms;
   * without it the switch is disabled (an empty registry would drop every room).
   */
  private _onFloorsToggle(on: boolean): void {
    const cfg = this._config;
    if (!cfg) return;
    const areas = this._reg?.areas;
    if (on) {
      if (!areas) return;
      const left = roomsWithoutFloor(cfg, areas);
      this._leftOut = left;
      this._emit(toggleFloors(cfg, true, areas));
      if (left.length) {
        this._notice = this._tr(
          "Räume ohne Etage wurden ausgeblendet: {0}. Etagen wieder auszuschalten stellt sie wieder her.",
          left.map((r) => this._areaName(r.area_id)).join(", "),
        );
      }
      return;
    }
    const restore = this._leftOut;
    this._leftOut = [];
    this._emit(toggleFloors(cfg, false, areas, restore));
  }

  private _toggleOpen(key: string): void {
    const open = new Set(this._open);
    open.has(key) ? open.delete(key) : open.add(key);
    this._open = open;
  }

  // ---------- rendering ----------

  private _form(ptr: Pointer, fields: Field[]): TemplateResult {
    const obj = ptr.length ? getIn(this._config, ptr) : this._config;
    const data: Record<string, unknown> = {};
    for (const f of fields) data[f.path] = getPath(obj, f.path) ?? f.default;
    const plain = fields.filter((f) => f.kind !== "color");
    const colors = fields.filter((f) => f.kind === "color" && (!f.when || f.when(obj)));
    const states = (this.hass?.states ?? {}) as Record<string, StateLike | undefined>;
    return html`<ha-form
        .hass=${this.hass}
        .data=${data}
        .schema=${toSchema(plain, obj)}
        .error=${fieldErrors(obj, plain, states, getPath, this._tr)}
        .computeLabel=${(s: { name: string }) => labelFor(fields, s.name, this._tr)}
        @value-changed=${(ev: CustomEvent) => this._onForm(ptr, fields, ev)}
      ></ha-form>
      ${colors.map((f) => this._colorRow(ptr, f, getPath(obj, f.path)))}`;
  }

  /** Color picker + hex field + reset (an empty value falls back to the HA theme). */
  private _colorRow(ptr: Pointer, f: Field, value: unknown): TemplateResult {
    const text = typeof value === "string" ? value : "";
    const swatch = /^#[0-9a-f]{6}$/i.test(text) ? text : "#808080";
    const error = colorError(value, this._tr);
    const set = (v: string) => this._update(ptr, (obj: object) => setPath(obj ?? {}, f.path, v));
    return html`<div class="color">
      <label>${this._tr(f.label)}</label>
      <div class="swatches">
        ${PALETTE.map(
          (c) => html`<button
            class="swatch ${c.value === text ? "on" : ""} ${c.value ? "" : "theme"}"
            title=${this._tr(c.label)}
            aria-label=${this._tr(c.label)}
            style=${c.value ? `background:${c.value}` : ""}
            @click=${() => set(c.value)}
          >${c.value ? "" : "T"}</button>`,
        )}
      </div>
      <div class="inputs">
        <input type="color" title=${this._tr("Eigene Farbe wählen")} aria-label=${this._tr("Eigene Farbe wählen")} .value=${swatch}
          @input=${(e: Event) => set((e.target as HTMLInputElement).value)} />
        <input type="text" placeholder="Theme" .value=${text}
          @change=${(e: Event) => set((e.target as HTMLInputElement).value.trim())} />
        <button class="icon" title=${this._tr("Zurücksetzen auf Theme")} aria-label=${this._tr("Zurücksetzen auf Theme")} ?disabled=${!text} @click=${() => set("")}>↺</button>
      </div>
      ${error ? html`<div class="warn">${error}</div>` : nothing}
    </div>`;
  }

  // ---------- color thresholds ----------

  /** Warns when a level lower in the graph (source > floor > room > consumer) has higher limits than the one above it. */
  private _levelOrderWarnings(): string[] {
    const top = (level: ThresholdLevel) => {
      const list = this._config?.colors?.level_thresholds?.[level] ?? this._config?.colors?.thresholds ?? [];
      return list.length ? Math.max(...list.map((t) => t.from || 0)) : undefined;
    };
    const out: string[] = [];
    THRESHOLD_LEVELS.forEach((upper, i) => {
      const lower = THRESHOLD_LEVELS[i + 1];
      if (!lower) return;
      const a = top(upper);
      const b = top(lower);
      if (a !== undefined && b !== undefined && b > a) {
        out.push(this._tr("Schwellwerte: „{0}“ liegt über „{1}“, obwohl diese Ebene weiter oben liegt.", this._tr(LEVEL_LABEL[lower]), this._tr(LEVEL_LABEL[upper])));
      }
    });
    return out;
  }

  /**
   * Editor for one threshold list: the shared one, one level, or the own list of an element.
   * The list lives at `path` (dotted) inside the object at `owner`. `fallback` is what applies while
   * the list is empty (shown as a hint, used by "copy" and by "scale" when there is nothing to scale).
   */
  private _thresholdEditor(owner: Pointer, path: string, defaults: ThresholdConfig[], fallback: ThresholdConfig[]): TemplateResult {
    const list = (getPath(getIn(this._config, owner), path) as ThresholdConfig[] | undefined) ?? [];
    const set = (next: ThresholdConfig[]) =>
      this._update(owner, (obj: object) => setPath(obj ?? {}, path, next.length ? next : undefined));
    const dups = duplicateThresholds(list);
    const next = (): ThresholdConfig =>
      defaults[list.length] ?? { from: Math.max(100, ...list.map((t) => t.from || 0)) * 2, color: "#f44336" };
    const scale = () => {
      const base = list.length ? list : fallback;
      set(base.map((t) => ({ ...t, from: Math.max(0, Math.round((t.from || 0) * this._scale)) })));
    };
    return html`
      ${list.length === 0 && fallback.length > 0
        ? html`<div class="hint">${this._tr("Hier gelten die Werte der übergeordneten Liste.")}</div>`
        : nothing}
      ${list.map(
        (t, i) => html`<div class="item">
          <div class="head">
            <span class="title">${this._tr("ab {0} W", t.from ?? 0)}</span>
            <button class="icon" title=${this._tr("Entfernen")} aria-label=${this._tr("Entfernen")}
              @click=${() => set(removeItem(list, i))}>✕</button>
          </div>
          ${this._form([...owner, ...path.split("."), i], THRESHOLD)}
        </div>`,
      )}
      <button class="add" @click=${() => set([...list, next()])}>${this._tr("+ Schwellwert")}</button>
      ${list.length === 0
        ? html`<button class="add" @click=${() => set(defaults.map((t) => ({ ...t })))}>${this._tr("Ampel-Werte einfügen")}</button>`
        : nothing}
      ${fallback.length > 0
        ? html`<button class="add" @click=${() => set(fallback.map((t) => ({ ...t })))}>${this._tr("Von der übergeordneten Liste übernehmen")}</button>`
        : nothing}
      ${list.length > 0 || fallback.length > 0
        ? html`<div class="scale">
            <label>${this._tr("Faktor")}
              <input type="number" min="0.1" step="0.1" .value=${String(this._scale)}
                @change=${(e: Event) => {
                  const v = Number((e.target as HTMLInputElement).value);
                  if (Number.isFinite(v) && v > 0) this._scale = v;
                }} />
            </label>
            <button class="add" @click=${scale}>${this._tr("Grenzen skalieren")}</button>
          </div>`
        : nothing}
      ${dups.map((d) => html`<div class="warn">⚠ ${this._tr("Mehrere Schwellwerte ab {0} W: nur einer davon gilt.", d)}</div>`)}
    `;
  }

  private _renderThresholds(): TemplateResult {
    const level = this._thrLevel;
    const c = this._config?.colors;
    const shared = c?.thresholds ?? [];
    const path = level === "all" ? "thresholds" : `level_thresholds.${level}`;
    return html`
      <h4>${this._tr("Schwellwerte (Farbe nach Leistung)")}</h4>
      <div class="hint">${this._tr("Ab dem jeweiligen Wert (in W) bekommen Linien und Balken diese Farbe, darunter gilt die normale Farbe.")}</div>
      <div class="hint">${this._tr("Optional gibt eine Stufe auch die Strichstärke vor. Jede Ebene kann eigene Werte haben, sonst gelten die Werte für „Alle“.")}</div>
      <div class="levels">
        ${(["all", ...THRESHOLD_LEVELS] as const).map(
          (l) => html`<button class="add ${l === level ? "on" : ""}" aria-pressed=${l === level ? "true" : "false"}
            @click=${() => (this._thrLevel = l)}>${this._tr(LEVEL_LABEL[l])}</button>`,
        )}
      </div>
      ${this._thresholdEditor(
        ["colors"],
        path,
        level === "all" ? DEFAULT_THRESHOLDS : DEFAULT_LEVEL_THRESHOLDS[level],
        level === "all" ? [] : shared,
      )}
      ${this._levelOrderWarnings().map((w) => html`<div class="warn">⚠ ${w}</div>`)}
    `;
  }

  /** Collapsible own thresholds of one element; they replace the list of its level. */
  private _elementThresholds(ptr: Pointer, level: ThresholdLevel): TemplateResult {
    const key = `${ptr.join(".")}.thr`;
    const own: ThresholdConfig[] = getIn(this._config, ptr)?.thresholds ?? [];
    const c = this._config?.colors;
    const levelList = c?.level_thresholds?.[level] ?? c?.thresholds ?? [];
    return html`<div class="own-thresholds">
      <button class="title" aria-expanded=${this._open.has(key) ? "true" : "false"} @click=${() => this._toggleOpen(key)}>
        ${this._open.has(key) ? "▾" : "▸"} ${this._tr("Eigene Schwellwerte ({0})", own.length)}
      </button>
      ${this._open.has(key)
        ? html`<div class="hint">${this._tr("Ersetzt für dieses Element die Werte der Ebene.")}</div>
            ${this._thresholdEditor(ptr, "thresholds", DEFAULT_LEVEL_THRESHOLDS[level], levelList)}`
        : nothing}
    </div>`;
  }

  // ---------- drag and drop (reorder within one list) ----------

  private _drag?: { list: string; index: number };

  private _handle(listPtr: Pointer, index: number): TemplateResult {
    return html`<span class="handle" draggable="true" title=${this._tr("Ziehen zum Sortieren")}
      @dragstart=${(e: DragEvent) => this._onDragStart(e, listPtr, index)}
      @dragend=${() => (this._drag = undefined)}>⠿</span>`;
  }

  private _onDragStart(e: DragEvent, listPtr: Pointer, index: number): void {
    this._drag = { list: listPtr.join("."), index };
    if (!e.dataTransfer) return;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
    const item = (e.target as HTMLElement).closest(".item");
    if (item) e.dataTransfer.setDragImage(item, 0, 0);
  }

  private _onOver(e: DragEvent, listPtr: Pointer): void {
    if (this._drag?.list === listPtr.join(".")) e.preventDefault();
  }

  private _onDrop(e: DragEvent, listPtr: Pointer, to: number): void {
    const drag = this._drag;
    if (!drag || drag.list !== listPtr.join(".")) return;
    e.preventDefault();
    e.stopPropagation();
    this._drag = undefined;
    this._update(listPtr, (l) => reorder(l, drag.index, to));
  }

  private _itemHead(key: string, title: string, sub: string, ptr: Pointer, index: number, count: number): TemplateResult {
    const listPtr = ptr.slice(0, -1);
    return html`<div class="head">
      ${this._handle(listPtr, index)}
      <button class="title" @click=${() => this._toggleOpen(key)}>
        ${this._open.has(key) ? "▾" : "▸"} ${title}<small>${sub}</small>
      </button>
      <button class="icon" title=${this._tr("Nach oben")} aria-label=${this._tr("Nach oben")} ?disabled=${index === 0}
        @click=${() => this._update(listPtr, (l) => moveItem(l, index, -1))}>↑</button>
      <button class="icon" title=${this._tr("Nach unten")} aria-label=${this._tr("Nach unten")} ?disabled=${index === count - 1}
        @click=${() => this._update(listPtr, (l) => moveItem(l, index, 1))}>↓</button>
      <button class="icon" title=${this._tr("Entfernen")} aria-label=${this._tr("Entfernen")}
        @click=${() => this._update(listPtr, (l) => removeItem(l, index))}>✕</button>
    </div>`;
  }

  private _renderSources(): TemplateResult {
    const sources = this._config?.sources ?? [];
    return html`
      <section>
        <h3>${this._tr("Stromquellen ({0})", sources.length)}</h3>
        ${sources.map((s: SourceConfig, i) => {
          const ptr: Pointer = ["sources", i];
          const key = `s${i}`;
          return html`<div class="item" @dragover=${(e: DragEvent) => this._onOver(e, ["sources"])} @drop=${(e: DragEvent) => this._onDrop(e, ["sources"], i)}>
            ${this._itemHead(key, s.name ?? s.type ?? this._tr("Quelle"), s.entity ?? "", ptr, i, sources.length)}
            ${this._open.has(key) ? html`${this._form(ptr, SOURCE)}${this._elementThresholds(ptr, "source")}` : nothing}
          </div>`;
        })}
        <button class="add" @click=${() => this._addSource()}>${this._tr("+ Quelle hinzufügen")}</button>
      </section>
    `;
  }

  private _addSource(): void {
    this._open = new Set(this._open).add(`s${this._config?.sources?.length ?? 0}`);
    this._update(["sources"], (l) => [...(l ?? []), { entity: "", type: "generic" }]);
  }

  private _renderConsumers(roomPtr: Pointer): TemplateResult {
    const consumers = getIn(this._config, [...roomPtr, "consumers"]) ?? [];
    return html`
      <h3>${this._tr("Verbraucher ({0})", consumers.length)}</h3>
      ${consumers.map((_c: unknown, i: number) => {
        const ptr: Pointer = [...roomPtr, "consumers", i];
        return html`<div class="item" @dragover=${(e: DragEvent) => this._onOver(e, [...roomPtr, "consumers"])} @drop=${(e: DragEvent) => this._onDrop(e, [...roomPtr, "consumers"], i)}>
          <div class="head">
            ${this._handle([...roomPtr, "consumers"], i)}
            <div class="title" style="flex:1">${this._form(ptr, consumerFields(consumerEntitiesExcept(this._config, ptr)))}</div>
            <button class="icon" title=${this._tr("Nach oben")} aria-label=${this._tr("Nach oben")} ?disabled=${i === 0}
              @click=${() => this._update([...roomPtr, "consumers"], (l) => moveItem(l, i, -1))}>↑</button>
            <button class="icon" title=${this._tr("Nach unten")} aria-label=${this._tr("Nach unten")} ?disabled=${i === consumers.length - 1}
              @click=${() => this._update([...roomPtr, "consumers"], (l) => moveItem(l, i, 1))}>↓</button>
            <button class="icon" title=${this._tr("Entfernen")} aria-label=${this._tr("Entfernen")}
              @click=${() => this._update([...roomPtr, "consumers"], (l) => removeItem(l, i))}>✕</button>
          </div>
          ${this._elementThresholds(ptr, "consumer")}
        </div>`;
      })}
      <button class="add"
        @click=${() => this._update([...roomPtr, "consumers"], (l) => [...(l ?? []), { entity: "" }])}>
        ${this._tr("+ Verbraucher")}
      </button>
    `;
  }

  private _renderRooms(listPtr: Pointer, nested: boolean, floorId?: string): TemplateResult {
    const rooms: RoomConfig[] = getIn(this._config, listPtr) ?? [];
    const free = this._areaOptions(floorId);
    return html`
      ${rooms.map((r, i) => {
        const ptr: Pointer = [...listPtr, i];
        const key = ptr.join(".");
        return html`<div class="item ${nested ? "nested" : ""}" @dragover=${(e: DragEvent) => this._onOver(e, listPtr)} @drop=${(e: DragEvent) => this._onDrop(e, listPtr, i)}>
          ${this._itemHead(key, this._areaName(r.area_id), this._tr("{0} Verbraucher", r.consumers?.length ?? 0), ptr, i, rooms.length)}
          ${this._open.has(key)
            ? html`${this._form(ptr, roomFields(this._areaOptions(floorId, r.area_id)))}${this._elementThresholds(ptr, "room")}${this._renderConsumers(ptr)}`
            : nothing}
        </div>`;
      })}
      <button class="add" ?disabled=${!free.length} @click=${() => this._addRoom(listPtr, free[0].value)}>${this._tr("+ Raum")}</button>
      ${this._reg && !free.length
        ? html`<div class="warn">${this._tr("Keine weiteren Bereiche in Home Assistant verfügbar.")}</div>`
        : nothing}
    `;
  }

  private _addRoom(listPtr: Pointer, areaId: string): void {
    const n = (getIn(this._config, listPtr) ?? []).length;
    this._open = new Set(this._open).add([...listPtr, n].join("."));
    this._update(listPtr, (l) => [...(l ?? []), { area_id: areaId, consumers: [] }]);
  }

  private _renderStructure(): TemplateResult {
    const cfg = this._config;
    const useFloors = !!cfg?.floors;
    const floors: FloorConfig[] = cfg?.floors ?? [];
    const freeFloors = this._floorChoices("");
    return html`
      <section>
        <h3>${this._tr("Struktur")}</h3>
        <ha-formfield .label=${this._tr("Etagen verwenden")}>
          <ha-switch
            .checked=${useFloors}
            .disabled=${!useFloors && !this._reg}
            @change=${(ev: Event) => this._onFloorsToggle((ev.target as HTMLInputElement).checked)}
          ></ha-switch>
        </ha-formfield>
        ${useFloors
          ? html`
              ${floors.map((f, i) => {
                const ptr: Pointer = ["floors", i];
                const key = ptr.join(".");
                return html`<div class="item" @dragover=${(e: DragEvent) => this._onOver(e, ["floors"])} @drop=${(e: DragEvent) => this._onDrop(e, ["floors"], i)}>
                  ${this._itemHead(key, this._floorName(f.floor_id), this._tr("{0} Räume", f.rooms?.length ?? 0), ptr, i, floors.length)}
                  ${this._open.has(key)
                    ? html`${this._form(ptr, floorFields(this._floorChoices(f.floor_id)))}${this._elementThresholds(ptr, "floor")}${this._renderRooms([...ptr, "rooms"], true, f.floor_id)}`
                    : nothing}
                </div>`;
              })}
              <button class="add" ?disabled=${!freeFloors.length}
                @click=${() => this._update(["floors"], (l) => [...(l ?? []), { floor_id: freeFloors[0].value, rooms: [] }])}>
                ${this._tr("+ Etage")}
              </button>
              ${this._reg && !freeFloors.length
                ? html`<div class="warn">${this._tr("Keine weiteren Etagen in Home Assistant angelegt.")}</div>`
                : nothing}`
          : this._renderRooms(["rooms"], false)}
      </section>
    `;
  }

  protected render(): TemplateResult {
    if (!this._config) return html``;
    const dups = findDuplicates(this._config);
    const theme = getComputedStyle(this);
    const contrast = contrastWarning(
      this._config.colors,
      theme.getPropertyValue("--primary-text-color"),
      theme.getPropertyValue("--card-background-color"),
      this._tr,
    );
    const conflict = sumConflict(this._config, (this.hass?.states ?? {}) as Record<string, StateLike | undefined>);
    return html`
      <section><h3>${this._tr("Allgemein")}</h3>${this._form([], GENERAL)}</section>
      <section><h3>${this._tr("Farben")}</h3>${this._form([], COLORS)}${this._renderThresholds()}${contrast ? html`<div class="warn">⚠ ${contrast}</div>` : nothing}</section>
      <section><h3>${this._tr("Zuhause")}</h3>${this._form([], HOME)}</section>
      ${this._renderSources()} ${this._renderStructure()}
      ${this._notice ? html`<div class="warn">⚠ ${this._notice}</div>` : nothing}
      ${conflict
        ? html`<div class="warn">⚠ ${this._tr("Die Räume verbrauchen zusammen {0} W, mehr als der Gesamt-Sensor ({1} W). „Nicht erfasst“ wird nicht angezeigt.", Math.round(conflict.rooms), Math.round(conflict.total))}</div>`
        : nothing}
      ${dups.map(
        (d) => html`<div class="warn">⚠ ${this._tr("{0} ist mehrfach zugeordnet: {1}", d.entity, d.places.join(", "))}</div>`,
      )}
    `;
  }
}

defineOnce("detailed-energy-card-editor", DetailedEnergyCardEditor);
