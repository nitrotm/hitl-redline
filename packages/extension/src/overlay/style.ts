import { RECT_STROKE } from '../geometry.ts'

// the cursors of the drawing tools: a crosshair for the rectangle, a crosshair with an arrow for
// the arrow, a pencil for the pen, its tip where the stroke goes
const ARROW = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g stroke="#111" stroke-width="3" stroke-linecap="round"><path d="M6 1v10M1 6h10"/></g><g stroke="#fff" stroke-width="1.2" stroke-linecap="round"><path d="M6 1v10M1 6h10"/></g><path d="M12 22L21 13M15 13h6v6" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
)}") 6 6, crosshair`
const PENCIL = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M3 21l1.5-5L16 4.5a2.1 2.1 0 013 3L7.5 19z" fill="#fff" stroke="#111" stroke-width="1.5" stroke-linejoin="round"/><path d="M3 21l1.5-5 3 3z" fill="#111"/></svg>'
)}") 3 21, crosshair`

// the overlay's styles, in its shadow root: nothing of the page's reaches it
export const OVERLAY_CSS = `
:host { all: initial; }
.device { position: fixed; inset: 0; background: #27272a; pointer-events: auto; }
.device[hidden] { display: none; }
.device .screen { position: absolute; transform-origin: 0 0; box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5); background: #fff; }
.device iframe { display: block; border: 0; background: #fff; }
.device-label { position: absolute; left: 0; right: 0; text-align: center; color: #a1a1aa; font: 12px system-ui, sans-serif; }
/* while the frame of a device is captured, it alone shows */
:host(.capturing) .frozen, :host(.capturing) .toolbar, :host(.capturing) .popover, :host(.capturing) .toast, :host(.capturing) .device-label { visibility: hidden; }
.frozen { position: fixed; inset: 0; background: #18181b; pointer-events: auto; }
.frozen[hidden] { display: none; }
.canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; user-select: none; }
.canvas[data-tool="rect"] { cursor: crosshair; }
.canvas[data-tool="arrow"] { cursor: ${ARROW}; }
.canvas[data-tool="freehand"] { cursor: ${PENCIL}; }
.canvas[data-tool="select"] { cursor: default; }
.mark { pointer-events: none; }
.canvas[data-tool="select"] .mark { pointer-events: auto; cursor: move; }
.hit { fill: transparent; stroke: transparent; stroke-width: 14; }
.rect { fill: none; stroke-width: ${RECT_STROKE}; }
.halo { fill: none; stroke: rgba(255, 255, 255, 0.9); stroke-width: ${RECT_STROKE}; }
.stroke { stroke: rgba(255, 255, 255, 0.7); stroke-width: 1; paint-order: stroke; }
.badge { stroke: #fff; stroke-width: 1.5; }
.label { fill: #fff; font: bold 12px system-ui, sans-serif; text-anchor: middle; dominant-baseline: middle; user-select: none; }
.mark.selected .rect, .mark.highlighted .rect { stroke-width: ${RECT_STROKE + 2}; filter: drop-shadow(0 0 4px rgba(0, 0, 0, 0.5)); }
.mark.selected .stroke, .mark.highlighted .stroke { filter: drop-shadow(0 0 4px rgba(0, 0, 0, 0.6)); }
.mark.highlighted .badge { stroke: #111; stroke-width: 2; }

.toolbar {
  position: fixed; top: 12px; right: 12px; display: flex; align-items: center; gap: 2px; padding: 4px;
  background: #1f2023; color: #f4f4f5; border-radius: 10px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  pointer-events: auto; font: 13px system-ui, sans-serif; user-select: none;
}
.toolbar.live .annotating { display: none; }
.annotating { display: contents; }
.toolbar button {
  all: unset; box-sizing: border-box; min-width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border-radius: 7px; cursor: pointer; color: inherit;
}
.toolbar button:hover { background: #3a3b40; }
.toolbar button.on { background: #e11d48; }
.toolbar button:disabled { opacity: 0.35; cursor: default; background: none; }
.toolbar button:focus-visible { outline: 2px solid #60a5fa; }
.toolbar .capture { padding: 0 8px; }
.toolbar:not(.live) .capture .label { display: none; }
.toolbar.live .capture { background: #e11d48; font-weight: 600; }
.toolbar .device-select {
  font: inherit; color: inherit; background: #2a2b2f; border: 1px solid #3a3b40; border-radius: 7px; height: 30px; padding: 0 6px; margin-right: 2px; cursor: pointer;
}
.toolbar:not(.live) .device-select { display: none; }
.toolbar .grip { display: grid; place-items: center; width: 14px; height: 30px; cursor: grab; color: #71717a; }
.toolbar .grip svg { width: 14px; }
.toolbar .swatch::after { content: ''; width: 14px; height: 14px; border-radius: 50%; background: var(--c); }
.toolbar .swatch.on { background: none; }
.toolbar .swatch.on::after { box-shadow: 0 0 0 2px #1f2023, 0 0 0 3.5px #f4f4f5; }
.toolbar .sep { width: 1px; height: 20px; background: #3a3b40; margin: 0 3px; }
.toolbar .snapshot-id { padding: 0 4px; color: #a1a1aa; font-weight: 600; }

.popover {
  position: fixed; display: flex; gap: 8px; align-items: flex-start; width: 320px; padding: 8px;
  background: #fff; color: #18181b; border-radius: 10px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35); pointer-events: auto;
  font: 13px/1.4 system-ui, sans-serif;
}
.popover[hidden] { display: none; }
.popover .badge { flex: none; padding: 1px 7px; border-radius: 10px; color: #fff; font-weight: 700; font-size: 12px; stroke: none; }
.popover textarea {
  flex: 1; resize: vertical; min-height: 40px; font: inherit; color: inherit; background: #fff;
  border: 1px solid #d4d4d8; border-radius: 6px; padding: 5px 7px; outline: none;
}
.popover textarea:focus { border-color: #e11d48; }
.popover .trash {
  all: unset; flex: none; width: 28px; height: 28px; display: grid; place-items: center; border-radius: 6px; cursor: pointer; color: #71717a;
}
.popover .trash:hover { background: #fee2e2; color: #b91c1c; }
.popover .trash:focus-visible { outline: 2px solid #60a5fa; }

.toast {
  position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); max-width: 420px; padding: 8px 12px; border-radius: 8px;
  background: #1f2023; color: #f4f4f5; font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}
.toast.error { background: #7f1d1d; }
.toast[hidden] { display: none; }
`
