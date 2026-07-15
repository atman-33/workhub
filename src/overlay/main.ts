// Ink overlay page (no React): renders temporary ink strokes on a transparent
// fullscreen canvas. Driven entirely by events from the Rust side — see
// src-tauri/src/ink/. Stroke behavior is ported from Desktop Ink's
// OverlayWindow (WPF): 3px round-cap lines, red/blue/green pen cycling, and
// Shift-snapped horizontal/vertical segments with mid-stroke transitions.
import { listen } from "@tauri-apps/api/event";

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  color: string;
  points: Point[];
}

const COLORS = ["#FF0000", "#0000FF", "#00FF00"];
/** Min drag distance before Shift-snap kicks in (matches WPF dead zone). */
const SNAP_DEAD_ZONE = 5;
const LINE_WIDTH = 3;

const canvas = document.getElementById("ink") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const palette = document.getElementById("palette")!;

let strokes: Stroke[] = [];
let active: Stroke | null = null;
let colorIndex = 0;
/** True while the last point of the active stroke is a Shift-snapped point. */
let snapped = false;

/** Crosshair cursor in the current pen color (white outline for contrast). */
function crosshairCursor(color: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">` +
    `<g stroke="#ffffff" stroke-width="4" stroke-linecap="round">` +
    `<path d="M12 2v7M12 15v7M2 12h7M15 12h7"/></g>` +
    `<g stroke="${color}" stroke-width="2" stroke-linecap="round">` +
    `<path d="M12 2v7M12 15v7M2 12h7M15 12h7"/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, crosshair`;
}

/** Reflect the current pen color in the cursor and the edge badge. */
function renderColorIndicator() {
  // Two-step cursor swap: without pointer movement Chromium sometimes skips
  // the cursor update; routing through an intermediate builtin cursor forces
  // a change notification (paired with the backend's cursor jiggle).
  canvas.style.cursor = "wait";
  requestAnimationFrame(() => {
    canvas.style.cursor = crosshairCursor(COLORS[colorIndex]);
  });
  palette.innerHTML = "";
  COLORS.forEach((color, i) => {
    const dot = document.createElement("span");
    dot.className = i === colorIndex ? "dot active" : "dot";
    dot.style.background = color;
    palette.appendChild(dot);
  });
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redraw();
}

function redraw() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of active ? [...strokes, active] : strokes) {
    if (stroke.points.length < 2) continue;
    ctx.strokeStyle = stroke.color;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    ctx.stroke();
  }
}

function addPoint(e: PointerEvent) {
  if (!active) return;
  const p: Point = { x: e.clientX, y: e.clientY };
  const start = active.points[0];
  if (e.shiftKey) {
    const dx = p.x - start.x;
    const dy = p.y - start.y;
    if (Math.hypot(dx, dy) >= SNAP_DEAD_ZONE) {
      // Snap to horizontal or vertical from the stroke's start point; while
      // snapped, replace the last point so the segment stays straight.
      const q: Point =
        Math.abs(dy) < Math.abs(dx) ? { x: p.x, y: start.y } : { x: start.x, y: p.y };
      if (snapped && active.points.length > 1) {
        active.points[active.points.length - 1] = q;
      } else {
        active.points.push(q);
      }
      snapped = true;
      redraw();
      return;
    }
  }
  snapped = false;
  active.points.push(p);
  redraw();
}

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  active = { color: COLORS[colorIndex], points: [{ x: e.clientX, y: e.clientY }] };
  snapped = false;
});

canvas.addEventListener("pointermove", (e) => {
  if (e.buttons & 1) addPoint(e);
});

function endStroke() {
  if (!active) return;
  if (active.points.length > 1) strokes.push(active);
  active = null;
  snapped = false;
  redraw();
}

canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);

window.addEventListener("resize", resize);
resize();
renderColorIndicator();

void listen("ink://activate", () => {
  strokes = [];
  active = null;
  snapped = false;
  resize();
  renderColorIndicator();
});

void listen("ink://deactivate", () => {
  strokes = [];
  active = null;
  snapped = false;
  redraw();
});

void listen("ink://cycle-color", () => {
  colorIndex = (colorIndex + 1) % COLORS.length;
  renderColorIndicator();
});
