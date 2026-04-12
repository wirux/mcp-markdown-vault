import { describe, it, expect } from "vitest";
import { HintsEngine } from "./hints.js";
import { WorkflowStateMachine, WorkflowPlace } from "./workflow-state.js";

describe("HintsEngine", () => {
  describe("hints based on workflow state", () => {
    it("suggests 'search' and 'list vault' when IDLE", () => {
      const sm = new WorkflowStateMachine();
      const hints = HintsEngine.getHints(sm);
      expect(hints.nextActions.length).toBeGreaterThan(0);
      expect(hints.nextActions.some((h) => h.includes("search"))).toBe(true);
    });

    it("suggests 'open a note' and 'refine' when EXPLORING", () => {
      const sm = new WorkflowStateMachine();
      sm.fire("search");
      const hints = HintsEngine.getHints(sm);
      expect(hints.nextActions.some((h) => h.includes("open"))).toBe(true);
      expect(hints.nextActions.some((h) => h.includes("refine"))).toBe(true);
    });

    it("suggests 'save' and 'go back' when EDITING", () => {
      const sm = new WorkflowStateMachine();
      sm.fire("search");
      sm.fire("open_note");
      const hints = HintsEngine.getHints(sm);
      expect(hints.nextActions.some((h) => h.includes("save"))).toBe(true);
      expect(hints.nextActions.some((h) => h.includes("back"))).toBe(true);
    });

    it("suggests 'done' and 'edit more' when REVIEWING", () => {
      const sm = new WorkflowStateMachine();
      sm.fire("search");
      sm.fire("open_note");
      sm.fire("save");
      const hints = HintsEngine.getHints(sm);
      expect(hints.nextActions.some((h) => h.includes("done"))).toBe(true);
    });
  });

  describe("tool-specific hints", () => {
    it("returns hints for vault tool", () => {
      const sm = new WorkflowStateMachine();
      const hints = HintsEngine.getToolHints(sm, "vault");
      expect(hints.length).toBeGreaterThan(0);
    });

    it("returns hints for edit tool", () => {
      const sm = new WorkflowStateMachine();
      sm.fire("search");
      sm.fire("open_note");
      const hints = HintsEngine.getToolHints(sm, "edit");
      expect(hints.length).toBeGreaterThan(0);
    });

    it("returns hints for view tool", () => {
      const sm = new WorkflowStateMachine();
      sm.fire("search");
      const hints = HintsEngine.getToolHints(sm, "view");
      expect(hints.length).toBeGreaterThan(0);
    });

    it("returns hints for workflow tool", () => {
      const sm = new WorkflowStateMachine();
      const hints = HintsEngine.getToolHints(sm, "workflow");
      expect(hints.length).toBeGreaterThan(0);
    });

    it("returns hints for system tool", () => {
      const sm = new WorkflowStateMachine();
      const hints = HintsEngine.getToolHints(sm, "system");
      expect(hints.length).toBeGreaterThan(0);
    });
  });

  describe("formatResponse", () => {
    it("appends hints section to a tool response", () => {
      const sm = new WorkflowStateMachine();
      const response = "some data";
      const formatted = HintsEngine.formatResponse(sm, "vault", response);

      expect(formatted.result).toBe("some data");
      expect(formatted.hints).toBeDefined();
      expect(formatted.hints.currentState).toBe(WorkflowPlace.IDLE);
      expect(formatted.hints.nextActions.length).toBeGreaterThan(0);
      expect(formatted.hints.toolHints.length).toBeGreaterThan(0);
    });

    it("includes available transitions", () => {
      const sm = new WorkflowStateMachine();
      sm.fire("search");
      const formatted = HintsEngine.formatResponse(sm, "view", {});
      expect(formatted.hints.availableTransitions).toContain("open_note");
      expect(formatted.hints.availableTransitions).toContain("refine");
    });
  });
});
