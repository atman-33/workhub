// Ink overlay page (no React): renders temporary ink strokes on a transparent
// fullscreen canvas. Driven entirely by events from the Rust side — see
// src-tauri/src/ink/. Stroke behavior is ported from Desktop Ink's
// OverlayWindow (WPF): 3px round-cap lines, red/blue/green pen cycling, and
// Shift-snapped horizontal/vertical segments with mid-stroke transitions.
//
// Alt+C saves what is on screen: the backend already holds a grab of the
// monitor from before the overlay appeared, so only the strokes are sent back
// and the composition happens in Rust (src-tauri/src/ink/store.rs).
//
// A successful Alt+C then puts the page in region-select mode: one drag picks
// an area, which is composed the same way and copied to the clipboard (no
// file), and the pen is back. Esc (forwarded by the backend, since this
// window never has keyboard focus) or a click without a drag leaves the mode
// without copying.
import { invoke } from "@tauri-apps/api/core";
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
const toast = document.getElementById("toast") as HTMLDivElement;
const dim = document.getElementById("dim") as HTMLDivElement;
const regionBox = document.getElementById("region") as HTMLDivElement;

let strokes: Stroke[] = [];
let active: Stroke | null = null;
let colorIndex = 0;
/** True while the last point of the active stroke is a Shift-snapped point. */
let snapped = false;
/** Last known pointer position (CSS px); null = chip hidden. */
let pointerPos: Point | null = null;
/** Region-select mode: a drag picks an area to copy instead of drawing. */
let regionMode = false;
/** Where the current region drag started (CSS px); null = no drag yet. */
let regionStart: Point | null = null;
/** A drag shorter than this (CSS px) is a click: it leaves the mode. */
const MIN_REGION = 8;

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
  // The pen chip marks the pen, which is not what a drag does in region mode.
  if (!pointerPos || regionMode) {
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

/** The drag's rectangle (CSS px), normalized so width/height are positive and clamped to the window. */
function regionRectTo(start: Point, p: Point): { x: number; y: number; w: number; h: number } {
  const x0 = Math.max(0, Math.min(start.x, p.x));
  const y0 = Math.max(0, Math.min(start.y, p.y));
  const x1 = Math.min(window.innerWidth, Math.max(start.x, p.x));
  const y1 = Math.min(window.innerHeight, Math.max(start.y, p.y));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function showRegion(r: { x: number; y: number; w: number; h: number }) {
  regionBox.style.left = `${r.x}px`;
  regionBox.style.top = `${r.y}px`;
  regionBox.style.width = `${r.w}px`;
  regionBox.style.height = `${r.h}px`;
  regionBox.style.display = "block";
  dim.style.display = "none";
}

function enterRegionMode() {
  regionMode = true;
  regionStart = null;
  regionBox.style.display = "none";
  dim.style.display = "block";
  // An unfinished pen stroke must not be left dangling under the new mode.
  endStroke();
  renderChip();
}

function exitRegionMode() {
  regionMode = false;
  regionStart = null;
  regionBox.style.display = "none";
  dim.style.display = "none";
  renderChip();
}

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  if (regionMode) {
    regionStart = { x: e.clientX, y: e.clientY };
    return;
  }
  active = { color: COLORS[colorIndex], points: [{ x: e.clientX, y: e.clientY }] };
  snapped = false;
});

canvas.addEventListener("pointermove", (e) => {
  if (regionMode) {
    if (regionStart && e.buttons & 1) {
      showRegion(regionRectTo(regionStart, { x: e.clientX, y: e.clientY }));
    }
    return;
  }
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

canvas.addEventListener("pointerup", (e) => {
  if (regionMode) {
    void finishRegion({ x: e.clientX, y: e.clientY });
    return;
  }
  endStroke();
});
canvas.addEventListener("pointercancel", () => {
  if (regionMode) {
    // The drag was interrupted: forget the selection, stay in the mode.
    regionStart = null;
    regionBox.style.display = "none";
    dim.style.display = "block";
    return;
  }
  endStroke();
});

window.addEventListener("resize", resize);
resize();
renderChip();

let toastTimer: number | undefined;

type ToastKind = "info" | "saving" | "ok" | "error";

function showToast(message: string, kind: ToastKind = "info", ms = 2200) {
  toast.textContent = message;
  toast.classList.toggle("error", kind === "error");
  toast.classList.toggle("saving", kind === "saving");
  toast.classList.toggle("ok", kind === "ok");
  toast.style.opacity = "1";
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.style.opacity = "0";
  }, ms);
}

/**
 * The drag ended: copy the area, or leave the mode if it was only a click.
 * The strokes are read off the canvas now, so what is copied is what is on
 * screen, and the pen is back before the backend has answered.
 */
async function finishRegion(end: Point) {
  const start = regionStart;
  regionStart = null;
  if (!start) return;
  const r = regionRectTo(start, end);
  exitRegionMode();
  if (r.w < MIN_REGION || r.h < MIN_REGION) return;
  // CSS px -> canvas px. The canvas is the window size times the device pixel
  // ratio, and the backend rescales to its own grab if that is a pixel off.
  const sx = canvas.width / window.innerWidth;
  const sy = canvas.height / window.innerHeight;
  showToast("Copying…", "saving", 30000);
  const data = canvas.toDataURL("image/png").split(",")[1] ?? "";
  try {
    const [w, h] = await invoke<[number, number]>("copy_ink_region", {
      base64Data: data,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      x: r.x * sx,
      y: r.y * sy,
      width: r.w * sx,
      height: r.h * sy,
    });
    showToast(`Copied ${w}×${h} to clipboard`, "ok", 2500);
  } catch (e) {
    showToast(String(e), "error", 4000);
  }
}

/**
 * Alt+C: hand the strokes to the backend, which composes them onto the screen
 * grab it took when drawing started and saves the result. Only the strokes
 * cross the bridge — a transparent PNG of a few lines, not a screenshot.
 *
 * The chip is left out of the export: it marks the pen, not the annotation.
 */
let saving = false;

async function save() {
  if (saving) return;
  // A capture with nothing drawn is still a capture: the screen on its own is
  // worth saving, and worth cropping.
  saving = true;
  // Instant feedback that the gesture registered; the compose+encode+copy can
  // take a beat on a large monitor, and silence there reads as "did nothing".
  showToast("Saving…", "saving", 30000);
  const data = canvas.toDataURL("image/png").split(",")[1] ?? "";
  try {
    const path = await invoke<string>("save_ink_capture", { base64Data: data });
    showToast(
      `Saved ${path.split("/").pop() ?? path} — copied. Drag to copy an area, Esc for the pen`,
      "ok",
      4000,
    );
    enterRegionMode();
  } catch (e) {
    showToast(String(e), "error", 4000);
  } finally {
    saving = false;
  }
}

void listen("ink://save", () => {
  void save();
});

// Esc, forwarded by the backend (this window never has keyboard focus). Only
// meaningful in region-select mode; in the pen mode it does nothing.
void listen("ink://cancel", () => {
  if (!regionMode) return;
  exitRegionMode();
  showToast("Back to the pen");
});

interface ActivatePayload {
  /** Echoed back so the backend can tell a live page from a dead one. */
  seq: number;
  /** Cursor position in physical px, relative to the overlay's monitor. */
  cursor: Point | null;
}

const activateListener = listen<ActivatePayload>("ink://activate", (event) => {
  // Answer first: if anything below throws, the page is still alive and must
  // not be torn down for it.
  void invoke("ink_overlay_ack", { seq: event.payload.seq });
  strokes = [];
  active = null;
  snapped = false;
  exitRegionMode();
  // Initial chip position: the backend sends the cursor position so the chip
  // shows immediately, before the first pointermove.
  const cursor = event.payload.cursor;
  if (cursor) {
    const dpr = window.devicePixelRatio || 1;
    pointerPos = { x: cursor.x / dpr, y: cursor.y / dpr };
  } else {
    pointerPos = null;
  }
  toast.style.opacity = "0";
  resize();
  renderChip();
});

// Tell the backend the page is listening. Activations sent before this are
// not checked for an answer, so a page that is still loading after a rebuild
// is not mistaken for a dead one.
void activateListener.then(() => invoke("ink_overlay_ready"));

void listen("ink://deactivate", () => {
  strokes = [];
  active = null;
  snapped = false;
  exitRegionMode();
  pointerPos = null;
  renderChip();
  redraw();
});

void listen("ink://cycle-color", () => {
  colorIndex = (colorIndex + 1) % COLORS.length;
  renderChip();
});
