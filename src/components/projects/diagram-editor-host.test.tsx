import { describe, expect, it } from "vitest";
import { FlowView } from "@/components/diagram/flow/flow-view";
import { PfdView } from "@/components/diagram/pfd/pfd-view";
import { AlgorithmView } from "@/components/diagram/algorithm/algorithm-view";
import { ArchitectureView } from "@/components/diagram/architecture/architecture-view";
import { IfdamView } from "@/components/diagram/ifdam/ifdam-view";
import { UsecaseView } from "@/components/diagram/usecase/usecase-view";
import { MatrixView } from "@/components/diagram/matrix2x2/matrix-view";
import { MindmapView } from "@/components/mindmap/mindmap-view";
import { ScheduleView } from "@/components/schedule/schedule-view";
import { editorComponentFor } from "./diagram-editor-host";

describe("editorComponentFor", () => {
  it("maps every diagram kind to its editor view", () => {
    expect(editorComponentFor("schedule")).toBe(ScheduleView);
    expect(editorComponentFor("mindmap")).toBe(MindmapView);
    expect(editorComponentFor("matrix2x2")).toBe(MatrixView);
    expect(editorComponentFor("flow")).toBe(FlowView);
    expect(editorComponentFor("pfd")).toBe(PfdView);
    expect(editorComponentFor("algorithm")).toBe(AlgorithmView);
    expect(editorComponentFor("usecase")).toBe(UsecaseView);
    expect(editorComponentFor("architecture")).toBe(ArchitectureView);
    expect(editorComponentFor("ifdam")).toBe(IfdamView);
  });

  it("maps an unknown kind to null", () => {
    expect(editorComponentFor("")).toBeNull();
    expect(editorComponentFor("note")).toBeNull();
    expect(editorComponentFor("backlog")).toBeNull();
    expect(editorComponentFor("Schedule")).toBeNull();
  });
});
