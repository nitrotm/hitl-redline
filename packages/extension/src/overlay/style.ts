import { RECT_STROKE } from '../geometry.ts'

// the overlay's styles, in its shadow root: nothing of the page's reaches it
export const OVERLAY_CSS = `
:host { all: initial; }
.canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; overflow: visible; pointer-events: none; }
.canvas.drawing { pointer-events: auto; cursor: crosshair; touch-action: none; }
.mark { pointer-events: none; }
.canvas:not(.drawing) .mark { pointer-events: auto; cursor: move; }
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
.toolbar button {
  all: unset; box-sizing: border-box; width: 30px; height: 30px; display: grid; place-items: center;
  border-radius: 7px; cursor: pointer; color: inherit;
}
.toolbar button:hover { background: #3a3b40; }
.toolbar button.on { background: #e11d48; }
.toolbar button:disabled { opacity: 0.35; cursor: default; background: none; }
.toolbar button:focus-visible { outline: 2px solid #60a5fa; }
.toolbar .swatch::after { content: ''; width: 14px; height: 14px; border-radius: 50%; background: var(--c); box-shadow: 0 0 0 1.5px #1f2023, 0 0 0 3px transparent; }
.toolbar .swatch.on { background: none; }
.toolbar .swatch.on::after { box-shadow: 0 0 0 2px #1f2023, 0 0 0 3.5px #f4f4f5; }
.toolbar .sep { width: 1px; height: 20px; background: #3a3b40; margin: 0 3px; }

.toast {
  position: fixed; top: 58px; right: 12px; max-width: 360px; padding: 8px 12px; border-radius: 8px;
  background: #1f2023; color: #f4f4f5; font: 13px/1.4 system-ui, sans-serif; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}
.toast.error { background: #7f1d1d; }
.toast[hidden] { display: none; }
`
