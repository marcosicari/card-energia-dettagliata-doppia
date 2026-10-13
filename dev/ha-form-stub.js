import { LitElement, html, css, nothing } from "lit";

/**
 * Stand-in for Home Assistant's <ha-form> in the dev preview (editor view only).
 * It draws the selectors the editor uses (text, number, boolean, select, entity, icon) in the look of
 * the Home Assistant dark theme, so the editor can be shown and photographed without a Home Assistant.
 */
export class HaFormStub extends LitElement {
  static properties = { hass: {}, data: {}, schema: {}, error: {}, computeLabel: {} };

  static styles = css`
    :host {
      display: block;
      color: var(--primary-text-color, #e1e1e1);
      font-family: Roboto, "Segoe UI", sans-serif;
      font-size: 14px;
    }
    .item {
      margin: 12px 0;
    }
    .field {
      background: #3a3a3a;
      border-bottom: 1px solid #9b9b9b;
      border-radius: 4px 4px 0 0;
      box-sizing: border-box;
      min-height: 56px;
      padding: 8px 16px;
      position: relative;
    }
    .field label {
      color: #b8b8b8;
      display: block;
      font-size: 12px;
    }
    .field input {
      background: none;
      border: none;
      color: inherit;
      font: inherit;
      font-size: 16px;
      outline: none;
      padding: 2px 0 0;
      width: 100%;
    }
    .field .unit {
      color: #9b9b9b;
      position: absolute;
      right: 16px;
      top: 26px;
    }
    .picker {
      align-items: center;
      display: flex;
      justify-content: space-between;
      padding-top: 2px;
    }
    .picker .name {
      font-size: 16px;
    }
    .picker .sub {
      color: #9b9b9b;
      font-size: 12px;
    }
    .picker .placeholder {
      color: #9b9b9b;
      font-size: 16px;
      padding: 10px 0;
    }
    .caret {
      color: #b8b8b8;
      font-size: 11px;
    }
    .row {
      align-items: center;
      display: flex;
      justify-content: space-between;
      min-height: 56px;
    }
    .row > span {
      flex: 1;
      padding-right: 16px;
    }
    .toggle {
      flex: none;
      background: #5a5a5a;
      border: none;
      border-radius: 14px;
      cursor: pointer;
      height: 28px;
      position: relative;
      width: 48px;
    }
    .toggle::after {
      background: #cfcfcf;
      border-radius: 50%;
      content: "";
      height: 20px;
      left: 4px;
      position: absolute;
      top: 4px;
      width: 20px;
    }
    .toggle.on {
      background: #2d3260;
      box-shadow: inset 0 0 0 1px #5560b8;
    }
    .toggle.on::after {
      background: #9aa4f0;
      left: 24px;
    }
    .title {
      margin: 8px 0 6px;
    }
    .boxes {
      display: flex;
      gap: 8px;
    }
    .box {
      align-items: center;
      background: none;
      border: 1px solid #3f424d;
      border-radius: 12px;
      color: inherit;
      cursor: pointer;
      display: flex;
      flex: 1;
      font: inherit;
      gap: 10px;
      padding: 14px 12px;
      text-align: left;
    }
    .box.on {
      background: #25264a;
      border-color: #2d3260;
    }
    .radio {
      border: 2px solid #9b9b9b;
      border-radius: 50%;
      box-sizing: border-box;
      height: 20px;
      position: relative;
      width: 20px;
    }
    .box.on .radio {
      border-color: #9aa4f0;
    }
    .box.on .radio::after {
      background: #9aa4f0;
      border-radius: 50%;
      content: "";
      height: 10px;
      left: 3px;
      position: absolute;
      top: 3px;
      width: 10px;
    }
    .check {
      align-items: center;
      display: flex;
      gap: 10px;
      padding: 6px 0;
    }
    .check .cb {
      border: 2px solid #9b9b9b;
      border-radius: 3px;
      box-sizing: border-box;
      height: 18px;
      position: relative;
      width: 18px;
    }
    .check.on .cb {
      background: #9aa4f0;
      border-color: #9aa4f0;
    }
    .check.on .cb::after {
      border: solid #1c1c1c;
      border-width: 0 2px 2px 0;
      content: "";
      height: 8px;
      left: 5px;
      position: absolute;
      top: 1px;
      transform: rotate(45deg);
      width: 4px;
    }
    .error {
      color: #ff6b5e;
      font-size: 12px;
      padding: 4px 16px 0;
    }
  `;

  _label(item) {
    const text = typeof this.computeLabel === "function" ? this.computeLabel(item) : item.name;
    return item.required ? `${text} *` : text;
  }

  _set(name, value) {
    const next = { ...this.data, [name]: value };
    this.dispatchEvent(new CustomEvent("value-changed", { detail: { value: next }, bubbles: true, composed: true }));
  }

  _entity(item, value) {
    const st = this.hass?.states?.[value];
    const label = this._label(item);
    return html`<div class="field">
      <label>${label}</label>
      ${value
        ? html`<div class="picker">
            <div>
              <div class="name">${st?.attributes?.friendly_name ?? value}</div>
              <div class="sub">${value}</div>
            </div>
            <span class="caret">▼</span>
          </div>`
        : html`<div class="picker"><span class="placeholder">Entität auswählen</span><span class="caret">▼</span></div>`}
    </div>`;
  }

  _select(item, value) {
    const cfg = item.selector.select;
    const options = cfg.options ?? [];
    const label = this._label(item);
    if (cfg.multiple) {
      const list = Array.isArray(value) ? value : [];
      return html`<div class="title">${label}</div>
        ${options.map((o) => {
          const on = list.includes(o.value);
          return html`<div class="check ${on ? "on" : ""}" @click=${() => this._set(item.name, on ? list.filter((v) => v !== o.value) : [...list, o.value])}>
            <span class="cb"></span><span>${o.label}</span>
          </div>`;
        })}`;
    }
    if (cfg.mode === "box") {
      return html`<div class="title">${label}</div>
        <div class="boxes">
          ${options.map(
            (o) => html`<button class="box ${o.value === value ? "on" : ""}" @click=${() => this._set(item.name, o.value)}>
              <span class="radio"></span><span>${o.label}</span>
            </button>`,
          )}
        </div>`;
    }
    const shown = options.find((o) => o.value === value)?.label ?? value ?? "";
    return html`<div class="field">
      <label>${label}</label>
      <div class="picker"><span class="name">${shown}</span><span class="caret">▼</span></div>
    </div>`;
  }

  _control(item) {
    const value = this.data?.[item.name];
    const sel = item.selector ?? {};
    const label = this._label(item);
    if (sel.boolean) {
      return html`<div class="row"><span>${label}</span>
        <button class="toggle ${value ? "on" : ""}" aria-label=${label} aria-pressed=${value ? "true" : "false"} @click=${() => this._set(item.name, !value)}></button></div>`;
    }
    if (sel.select) return this._select(item, value);
    if (sel.entity) return this._entity(item, value);
    if (sel.number) {
      return html`<div class="field"><label>${label}</label>
        <input type="number" .value=${value ?? ""} @change=${(e) => this._set(item.name, e.target.value === "" ? undefined : Number(e.target.value))} />
        ${sel.number.unit_of_measurement ? html`<span class="unit">${sel.number.unit_of_measurement}</span>` : nothing}</div>`;
    }
    return html`<div class="field"><label>${label}</label>
      <input type="text" .value=${value ?? ""} @change=${(e) => this._set(item.name, e.target.value)} /></div>`;
  }

  render() {
    return html`${(this.schema ?? []).map((item) => {
      const err = this.error?.[item.name];
      return html`<div class="item">${this._control(item)}${err ? html`<div class="error">${err}</div>` : nothing}</div>`;
    })}`;
  }
}

if (!customElements.get("ha-form")) customElements.define("ha-form", HaFormStub);
