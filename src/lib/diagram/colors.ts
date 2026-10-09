/**
 * The palette every diagram kind draws with.
 *
 * Colors are a fixed list rather than free-form values: the canvas, the HTML
 * export and the PNG export must render a note identically, and only a closed
 * set can guarantee that without shipping a color parser to each of them.
 *
 * Kept identical to the schedule palette so that one project's notes read as
 * one set of documents.
 */
export const COLORS = ["blue", "green", "amber", "red", "purple", "gray"] as const;
export type Color = (typeof COLORS)[number];

export const COLOR_HEX: Record<Color, string> = {
  blue: "#3b82f6",
  green: "#22c55e",
  amber: "#f59e0b",
  red: "#ef4444",
  purple: "#a855f7",
  gray: "#6b7280",
};

/**
 * Paper colours for sticky notes: a pale tint of each palette colour, with
 * `COLOR_HEX` serving as the border.
 *
 * Deliberately light in both the app and the exports even though the app is
 * dark-only - a sticky reads as a piece of paper laid on the diagram, and a
 * dark one reads as just another node box.
 */
export const STICKY_FILL_HEX: Record<Color, string> = {
  blue: "#dbeafe",
  green: "#dcfce7",
  amber: "#fef3c7",
  red: "#fee2e2",
  purple: "#f3e8ff",
  gray: "#e5e7eb",
};

/** Text colour on sticky paper. Fixed, because the paper is fixed. */
export const STICKY_INK = "#1f2937";

export function isColor(value: string): value is Color {
  return (COLORS as readonly string[]).includes(value);
}
