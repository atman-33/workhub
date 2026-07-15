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
const chip = document.getElementById("chip") as HTMLDivElement;

let strokes: Stroke[] = [];
let active: Stroke | null = null;
let colorIndex = 0;
/** True while the last point of the active stroke is a Shift-snapped point. */
let snapped = false;
/** Last known pointer position (CSS px); null = chip hidden. */
let pointerPos: Point | null = null;

/** Chip offset from the pointer hotspot, toward the lower right. */
const CHIP_OFFSET = 16;
const CHIP_SIZE = 18; // 14px + 2*2px border

/**
 * Pen-color chip next to the pointer. A plain DOM element, deliberately NOT
 * the OS cursor: WebView2/Windows cache the visible cursor and ignore CSS
 * cursor changes until a real pointer interaction, so a pen-colored cursor
 * could not be refreshed reliably on Alt+S. DOM rendering always updates.
 */
function renderChip() {
  if (!pointerPos) {
    chip.style.display = "none";
    return;
  }
  const x = Math.min(pointerPos.x + CHIP_OFFSET, window.innerWidth - CHIP_SIZE);
  const y = Math.min(pointerPos.y + CHIP_OFFSET, window.innerHeight - CHIP_SIZE);
  chip.style.transform = `translate(${x}px, ${y}px)`;
  chip.style.background = COLORS[colorIndex];
  chip.style.display = "block";
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

// Track the pointer at window level so the chip follows during hover and
// drawing alike; hide it when the pointer leaves the overlay.
window.addEventListener("pointermove", (e) => {
  pointerPos = { x: e.clientX, y: e.clientY };
  renderChip();
});
document.addEventListener("pointerleave", () => {
  pointerPos = null;
  renderChip();
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
renderChip();

void listen<{ x: number; y: number } | null>("ink://activate", (event) => {
  strokes = [];
  active = null;
  snapped = false;
  // Initial chip position: the backend sends the cursor position (physical
  // px, relative to the overlay's monitor) so the chip shows immediately,
  // before the first pointermove.
  if (event.payload) {
    const dpr = window.devicePixelRatio || 1;
    pointerPos = { x: event.payload.x / dpr, y: event.payload.y / dpr };
  } else {
    pointerPos = null;
  }
  resize();
  renderChip();
});

void listen("ink://deactivate", () => {
  strokes = [];
  active = null;
  snapped = false;
  pointerPos = null;
  renderChip();
  redraw();
});

void listen("ink://cycle-color", () => {
  colorIndex = (colorIndex + 1) % COLORS.length;
  renderChip();
});
