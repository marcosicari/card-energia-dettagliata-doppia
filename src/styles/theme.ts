import { css } from "lit";
import type { ColorsConfig } from "../model/config";

const NOCTURNE: Record<string, string> = {
  "--efc-accent": "#9184d9",
  "--efc-flow": "#b5abfc",
  "--efc-inactive": "#75798c",
  "--efc-bar": "#b5abfc",
  "--efc-text": "#e9e9ed",
  "--efc-muted": "#9397ab",
  "--efc-line": "#3f424d",
};

/**
 * Inline CSS variables for the host element.
 * Precedence: colors.* > preset > HA theme (see :host defaults) > Nocturne fallback.
 */
export function colorVars(c: ColorsConfig | undefined): string {
  const vars: Record<string, string> = c?.preset === "nocturne" ? { ...NOCTURNE } : {};
  const set = (k: string, v?: string) => {
    if (v && v !== "theme") vars[k] = v;
  };
  set("--efc-accent", c?.accent);
  set("--efc-flow", c?.flow);
  set("--efc-inactive", c?.inactive);
  set("--efc-bar", c?.bar);
  set("--efc-bg", c?.background);
  set("--efc-text", c?.text);
  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

export const cardStyles = css`
  :host,
  ha-card {
    --_accent: var(--efc-accent, var(--primary-color, #9184d9));
    --_flow: var(--efc-flow, var(--primary-color, #b5abfc));
    --_inactive: var(--efc-inactive, var(--disabled-text-color, #75798c));
    --_bar: var(--efc-bar, var(--primary-color, #b5abfc));
    --_bg: var(--efc-bg, transparent);
    --_ground: var(--efc-ground, transparent);
    --_text: var(--efc-text, var(--primary-text-color, #e9e9ed));
    --_muted: var(--efc-muted, var(--secondary-text-color, #9397ab));
    --_line: var(--efc-line, var(--divider-color, #3f424d));
    display: block;
  }
  ha-card {
    background: var(--_bg);
    color: var(--_text);
    padding: 16px 20px 20px;
    overflow: hidden;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 16px;
  }
  h2 {
    margin: 0;
    font-size: 1.3em;
    font-weight: 600;
  }
  .modes {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 0 0 8px;
  }
  .modes button,
  .plant-tabs button {
    background: none;
    border: 1px solid var(--_line);
    border-radius: 8px;
    color: var(--_muted);
    cursor: pointer;
    font: inherit;
    font-size: 0.85em;
    padding: 4px 12px;
  }
  .modes button.on,
  .plant-tabs button.on {
    background: color-mix(in srgb, var(--_accent) 25%, transparent);
    border-color: var(--_accent);
    color: var(--_text);
  }
  .plant-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin: 0 0 12px;
  }
  /* several plants (options.plants_layout): the card of each plant sits inside the card around them */
  .plants.stack {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .plants.stack > * + * {
    border-top: 1px solid var(--_line);
    padding-top: 16px;
  }
  .plants.row {
    align-items: start;
    display: grid;
    gap: 16px 24px;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  }
  .plants > * {
    min-width: 0;
  }
  :host([embedded]) ha-card {
    --ha-card-background: transparent;
    --ha-card-border-radius: 0;
    --ha-card-border-width: 0;
    --ha-card-box-shadow: none;
    background: transparent;
    border: none;
    border-radius: 0;
    box-shadow: none;
    padding: 0;
  }
  :host([embedded]) h2 {
    font-size: 1.05em;
  }
  .modes .status {
    color: var(--_muted);
    font-size: 0.8em;
    margin-left: 8px;
  }
  .modes .status.warn {
    color: var(--warning-color, #ffb74d);
  }
  .path {
    color: var(--_muted);
    font-size: 0.9em;
    margin-top: 4px;
  }
  .badge {
    background: color-mix(in srgb, var(--_accent) 30%, transparent);
    border-radius: 8px;
    padding: 6px 12px;
    font-size: 0.85em;
    font-weight: 600;
    white-space: nowrap;
  }
  .scroll {
    overflow-x: auto;
    overflow-y: hidden;
  }
  .graph {
    position: relative;
  }
  svg.lines {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: visible;
  }
  path.line {
    fill: none;
    stroke: var(--_inactive);
    opacity: 0.55;
    stroke-linecap: round;
  }
  path.line.active {
    stroke: var(--_flow);
    opacity: 1;
  }
  path.line.flowing {
    stroke-dasharray: 4 8;
    animation: flow var(--dur, 2s) linear infinite;
  }
  /* paused while the card is scrolled out of view (see detailed-energy-card.ts) */
  :host(.offscreen) path.line.flowing {
    animation-play-state: paused;
  }
  path.line.flowing.reverse {
    animation-direction: reverse;
  }
  @keyframes flow {
    to {
      stroke-dashoffset: -12;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    path.line.flowing {
      animation: none;
    }
  }
  .node {
    position: absolute;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    padding: 0;
    cursor: pointer;
    text-align: center;
    max-width: 120px;
  }
  .node:focus-visible {
    outline: 2px solid var(--_accent);
    outline-offset: 2px;
    border-radius: 8px;
  }
  .circle {
    --c: var(--node-color, var(--_accent));
    display: grid;
    place-items: center;
    width: 54px;
    height: 54px;
    border-radius: 50%;
    border: 1.5px solid var(--_line);
    background: var(--_ground);
    --mdc-icon-size: 24px;
  }
  .circle.selected,
  .circle.source {
    border-color: var(--c);
  }
  .circle.selected {
    box-shadow: 0 0 14px color-mix(in srgb, var(--c) 55%, transparent);
  }
  .circle.home {
    width: 66px;
    height: 66px;
    border-color: var(--_accent);
    box-shadow: 0 0 18px color-mix(in srgb, var(--_accent) 40%, transparent);
    font-weight: 600;
    font-size: 0.85em;
    align-content: center;
  }
  .circle.room {
    width: 42px;
    height: 42px;
    --mdc-icon-size: 20px;
  }
  .pill {
    padding: 9px 20px;
    border: 1.5px solid var(--_line);
    border-radius: 10px;
    background: var(--_ground);
    font-weight: 600;
    white-space: nowrap;
  }
  .pill.selected {
    border-color: var(--_accent);
    box-shadow: 0 0 14px color-mix(in srgb, var(--_accent) 45%, transparent);
  }
  .pill small {
    font-weight: 400;
    color: var(--_muted);
    margin-left: 4px;
  }
  /* nodes and consumers that draw no power are shown faded */
  /* hidden behind the selected element (options.focus_selected): not clickable */
  .node.ghost {
    pointer-events: none;
  }
  .node.idle {
    opacity: 0.45;
  }
  /* list rows are faded through the muted text color and a lighter bar instead of opacity, which would push the text below readable contrast */
  .row.idle .name,
  .row.idle .val {
    color: var(--_muted);
  }
  .row.idle .bar {
    opacity: 0.45;
  }
  .label {
    color: var(--_muted);
    font-size: 0.85em;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* narrow room columns (many rooms, small displays): smaller labels, names are cut with an ellipsis instead of running into the neighbour */
  .node.tight .label {
    font-size: 0.75em;
  }
  .value {
    font-weight: 600;
    white-space: nowrap;
  }
  .warn {
    opacity: 0.5;
  }
  .detail {
    border-top: 1px solid var(--_line);
    margin-top: 20px;
    padding-top: 16px;
    container: detail / inline-size;
  }
  /* One grid for the whole list so name, bar and value columns line up across rows. */
  .list {
    display: grid;
    grid-template-columns: minmax(0, max-content) minmax(48px, 1fr) max-content;
    column-gap: 12px;
  }
  .detail-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .detail-head .muted {
    color: var(--_muted);
  }
  .row {
    display: grid;
    grid-template-columns: subgrid;
    grid-column: 1 / -1;
    align-items: center;
    padding: 8px 0;
    cursor: pointer;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    width: 100%;
    text-align: left;
  }
  .row .name {
    min-width: 0;
    /* long names must not squeeze the bar away; the bar takes all remaining width */
    max-width: 50cqw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row .name small {
    display: block;
    white-space: nowrap;
    color: var(--_muted);
    font-family: monospace;
    font-size: 0.75em;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .bar {
    /* each reached threshold range adds 1px, a cue besides the color */
    height: var(--bar-h, calc(3px + var(--level, 0) * 1px));
    border-radius: 2px;
    background: var(--_line);
  }
  .bar > div {
    height: 100%;
    border-radius: 2px;
    background: var(--_bar);
  }
  .row .val {
    text-align: right;
    font-weight: 600;
    white-space: nowrap;
  }
  /* Too narrow for a useful bar: drop it so name and value stay readable. */
  @container detail (max-width: 320px) {
    .list {
      grid-template-columns: minmax(0, 1fr) max-content;
    }
    .bar,
    .spacer {
      display: none;
    }
  }
  .empty,
  .error {
    color: var(--_muted);
    padding: 12px 0;
  }
  .error {
    color: var(--error-color, #db4437);
  }
`;
