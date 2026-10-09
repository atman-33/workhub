/**
 * The pure part of the diagram camera: zoom arithmetic and fitting.
 *
 * Screen position of a diagram point is `camera + p * zoom`. The hook that
 * wires this to the wheel and the right button is `use-camera.ts`.
 */
import type { Box } from "./sticky-layout";

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 2.5;
/** Padding around the diagram when fitting it to the viewport. */
export const FIT_PADDING = 48;
/** One wheel notch scales by this factor. */
export const ZOOM_STEP = 1.1;

export function clampZoom(zoom: number): number {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
}

/**
 * Zooms by one wheel notch about the screen point (`px`, `py`), keeping the
 * diagram point under it fixed. `deltaY < 0` zooms in.
 */
export function zoomAt(camera: Camera, px: number, py: number, deltaY: number): Camera {
  const next = clampZoom(camera.zoom * (deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP));
  const k = next / camera.zoom;
  return { zoom: next, x: px - (px - camera.x) * k, y: py - (py - camera.y) * k };
}

/**
 * The camera that frames `bounds` in a viewport of `width` x `height`, or
 * `null` while the viewport has no size yet.
 *
 * Never zooms *in* to fit: a two-element diagram blown up to fill the window
 * looks broken rather than roomy.
 */
export function fitCamera(
  bounds: Box,
  width: number,
  height: number,
  padding = FIT_PADDING,
): Camera | null {
  if (!width || !height) return null;
  const scale = Math.min(
    (width - padding * 2) / Math.max(bounds.width, 1),
    (height - padding * 2) / Math.max(bounds.height, 1),
    1,
  );
  const zoom = clampZoom(scale);
  return {
    zoom,
    x: width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: height / 2 - (bounds.y + bounds.height / 2) * zoom,
  };
}

/** Screen point (relative to the viewport's top-left) to diagram coordinates. */
export function toDiagramPoint(camera: Camera, screenX: number, screenY: number) {
  return { x: (screenX - camera.x) / camera.zoom, y: (screenY - camera.y) / camera.zoom };
}

/** The diagram-space rectangle a viewport of `width` x `height` shows. */
export function visibleBox(camera: Camera, width: number, height: number): Box {
  return {
    x: -camera.x / camera.zoom,
    y: -camera.y / camera.zoom,
    width: width / camera.zoom,
    height: height / camera.zoom,
  };
}
