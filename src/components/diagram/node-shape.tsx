import { createElement, type SVGProps } from "react";
import { shapeOf } from "@/lib/diagram/shapes";
import type { Box } from "@/lib/diagram/sticky-layout";

/**
 * A node's outline, drawn from the shape registry: the same numbers the export
 * serializes, so the screen and the file cannot disagree about a shape.
 * `grow` pads the box (a selection ring is the same shape a little larger).
 */
export function ShapeOutline({
  shape,
  box,
  grow = 0,
  ...props
}: {
  shape: string;
  box: Box;
  grow?: number;
} & Omit<SVGProps<SVGElement>, "ref">) {
  const padded: Box = {
    x: box.x - grow,
    y: box.y - grow,
    width: box.width + grow * 2,
    height: box.height + grow * 2,
  };
  const el = shapeOf(shape).outline(padded);
  return createElement(el.tag, { ...el.attrs, ...props });
}
