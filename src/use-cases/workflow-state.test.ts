import { describe, it, expect } from "vitest";
import {
  WorkflowStateMachine,
  WorkflowPlace,
} from "./workflow-state.js";
import { StateTransitionError } from "../domain/errors/index.js";

describe("WorkflowStateMachine", () => {
  describe("initial state", () => {
    it("starts with a token in IDLE", () => {
      const sm = new WorkflowStateMachine();
      expect(sm.currentPlace).toBe(WorkflowPlace.IDLE);
      expect(sm.hasToken(WorkflowPlace.IDLE)).toBe(true);
    });

    it("has no tokens in other places", () => {
      const sm = new WorkflowStateMachine();
      expect(sm.hasToken(WorkflowPlace.EXPLORING)).toBe(false);
      expect(sm.hasToken(WorkflowPlace.EDITING)).toBe(false);
      expect(sm.hasToken(WorkflowPlace.REVIEWING)).toBe(false);
    });
  });

  describe("transitions", () => {
    it("transitions from IDLE to EXPLORING via 'search'", () => {
      const sm = new WorkflowStateMachine();
      sm.fire("search");
      expect(sm.currentPlace).toBe(WorkflowPlace.EXPLORING);
    });

    it("transitions from EXPLORING to EDITING via 'open_note'", () => {
      const sm = new WorkflowStateMachine();
      sm.fire("search");
      sm.fire("open_note");
      expect(sm.currentPlace).toBe(WorkflowPlace.EDITING);
    });

    it("transitions from EDITING to REVIEWING via 'save'", () => {
      const sm = new WorkflowStateMachine();
      sm.fire("search");
      sm.fire("open_note");
      sm.fire("save");
      expect(sm.currentPlace).toBe(WorkflowPlace.REVIEWING);
    });

    it("transitions from REVIEWING back to IDLE via 'done'", () => {
      const sm = new WorkflowStateMachine();
      sm.fire("search");
      sm.fire("open_note");
      sm.fire("save");
      sm.fire("done");
      expect(sm.currentPlace).toBe(WorkflowPlace.IDLE);
    });

    it("can go from EXPLORING directly back to IDLE via 'reset'", () => {
      const sm = new WorkflowStateMachine();
      sm.fire("search");
      sm.fire("reset");
      expect(sm.currentPlace).toBe(WorkflowPlace.IDLE);
    });

    it("can go from EDITING back to EXPLORING via 'back'", () => {
      const sm = new WorkflowStateMachine();
      sm.fire("search");
      sm.fire("open_note");
      sm.fire("back");
      expect(sm.currentPlace).toBe(WorkflowPlace.EXPLORING);
    });

    it("can refine search while exploring", () => {
      const sm = new WorkflowStateMachine();
      sm.fire("search");
      sm.fire("refine");
      expect(sm.currentPlace).toBe(WorkflowPlace.EXPLORING);
    });
  });

  describe("invalid transitions", () => {
    it("throws StateTransitionError for invalid transition", () => {
      const sm = new WorkflowStateMachine();
      expect(() => sm.fire("save")).toThrow(StateTransitionError);
    });

    it("throws StateTransitionError when transition is not available from current place", () => {
      const sm = new WorkflowStateMachine();
      expect(() => sm.fire("open_note")).toThrow(StateTransitionError);
    });

    it("includes from/to in the error", () => {
      const sm = new WorkflowStateMachine();
      try {
        sm.fire("done");
        expect.fail("should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(StateTransitionError);
        expect((e as StateTransitionError).message).toContain("idle");
      }
    });
  });

  describe("availableTransitions", () => {
    it("lists transitions from IDLE", () => {
      const sm = new WorkflowStateMachine();
      const available = sm.availableTransitions();
      expect(available.map((t) => t.name)).toContain("search");
    });

    it("lists transitions from EXPLORING", () => {
      const sm = new WorkflowStateMachine();
      sm.fire("search");
      const names = sm.availableTransitions().map((t) => t.name);
      expect(names).toContain("open_note");
      expect(names).toContain("refine");
      expect(names).toContain("reset");
    });

    it("lists transitions from EDITING", () => {
      const sm = new WorkflowStateMachine();
      sm.fire("search");
      sm.fire("open_note");
      const names = sm.availableTransitions().map((t) => t.name);
      expect(names).toContain("save");
      expect(names).toContain("back");
    });
  });

  describe("history", () => {
    it("records transition history", () => {
      const sm = new WorkflowStateMachine();
      sm.fire("search");
      sm.fire("open_note");
      const history = sm.getHistory();
      expect(history).toHaveLength(2);
      expect(history[0]!.transition).toBe("search");
      expect(history[1]!.transition).toBe("open_note");
    });

    it("records timestamps", () => {
      const sm = new WorkflowStateMachine();
      sm.fire("search");
      const history = sm.getHistory();
      expect(history[0]!.timestamp).toBeInstanceOf(Date);
    });
  });

  describe("reset", () => {
    it("resets to IDLE from any state", () => {
      const sm = new WorkflowStateMachine();
      sm.fire("search");
      sm.fire("open_note");
      sm.hardReset();
      expect(sm.currentPlace).toBe(WorkflowPlace.IDLE);
    });

    it("clears history on hard reset", () => {
      const sm = new WorkflowStateMachine();
      sm.fire("search");
      sm.hardReset();
      expect(sm.getHistory()).toHaveLength(0);
    });
  });
});
