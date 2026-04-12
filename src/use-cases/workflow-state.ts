import { StateTransitionError } from "../domain/errors/index.js";

// ── Places (Petri net positions) ──────────────────────────────────

export enum WorkflowPlace {
  IDLE = "idle",
  EXPLORING = "exploring",
  EDITING = "editing",
  REVIEWING = "reviewing",
}

// ── Transitions ───────────────────────────────────────────────────

export interface WorkflowTransition {
  name: string;
  from: WorkflowPlace;
  to: WorkflowPlace;
}

/** All valid transitions in the Petri net. */
const TRANSITIONS: WorkflowTransition[] = [
  // IDLE →
  { name: "search", from: WorkflowPlace.IDLE, to: WorkflowPlace.EXPLORING },

  // EXPLORING →
  { name: "open_note", from: WorkflowPlace.EXPLORING, to: WorkflowPlace.EDITING },
  { name: "refine", from: WorkflowPlace.EXPLORING, to: WorkflowPlace.EXPLORING },
  { name: "reset", from: WorkflowPlace.EXPLORING, to: WorkflowPlace.IDLE },

  // EDITING →
  { name: "save", from: WorkflowPlace.EDITING, to: WorkflowPlace.REVIEWING },
  { name: "back", from: WorkflowPlace.EDITING, to: WorkflowPlace.EXPLORING },
  { name: "reset", from: WorkflowPlace.EDITING, to: WorkflowPlace.IDLE },

  // REVIEWING →
  { name: "done", from: WorkflowPlace.REVIEWING, to: WorkflowPlace.IDLE },
  { name: "open_note", from: WorkflowPlace.REVIEWING, to: WorkflowPlace.EDITING },
  { name: "search", from: WorkflowPlace.REVIEWING, to: WorkflowPlace.EXPLORING },
];

// ── History entry ─────────────────────────────────────────────────

export interface HistoryEntry {
  transition: string;
  from: WorkflowPlace;
  to: WorkflowPlace;
  timestamp: Date;
}

// ── State machine ─────────────────────────────────────────────────

/**
 * Petri net–inspired state machine for tracking agent workflow.
 *
 * A single token occupies exactly one place at a time.
 * Transitions move the token between places.
 */
export class WorkflowStateMachine {
  private place: WorkflowPlace = WorkflowPlace.IDLE;
  private history: HistoryEntry[] = [];

  /** The place currently holding the token. */
  get currentPlace(): WorkflowPlace {
    return this.place;
  }

  /** Check if a specific place has the token. */
  hasToken(place: WorkflowPlace): boolean {
    return this.place === place;
  }

  /**
   * Fire a named transition.
   * @throws StateTransitionError if the transition is not valid from the current place.
   */
  fire(transitionName: string): void {
    const transition = TRANSITIONS.find(
      (t) => t.name === transitionName && t.from === this.place,
    );

    if (!transition) {
      throw new StateTransitionError(
        this.place,
        `${transitionName} (not available from ${this.place})`,
      );
    }

    const from = this.place;
    this.place = transition.to;

    this.history.push({
      transition: transitionName,
      from,
      to: transition.to,
      timestamp: new Date(),
    });
  }

  /** List transitions available from the current place. */
  availableTransitions(): WorkflowTransition[] {
    return TRANSITIONS.filter((t) => t.from === this.place);
  }

  /** Get the full transition history. */
  getHistory(): readonly HistoryEntry[] {
    return this.history;
  }

  /** Force-reset to IDLE and clear history. */
  hardReset(): void {
    this.place = WorkflowPlace.IDLE;
    this.history = [];
  }
}
