import { WorkflowStateMachine, WorkflowPlace } from "./workflow-state.js";

export type ToolName = "vault" | "edit" | "view" | "workflow" | "system";

export interface WorkflowHints {
  currentState: WorkflowPlace;
  nextActions: string[];
  availableTransitions: string[];
}

export interface EnrichedResponse<T> {
  result: T;
  hints: WorkflowHints & { toolHints: string[] };
}

// ── State-based hints ─────────────────────────────────────────────

const STATE_HINTS: Record<WorkflowPlace, string[]> = {
  [WorkflowPlace.IDLE]: [
    "Use 'search' to find notes by keyword or semantic query.",
    "Use 'vault list' to browse the vault structure.",
    "Use 'workflow status' to check current state.",
  ],
  [WorkflowPlace.EXPLORING]: [
    "Use 'open_note' to open a note for editing.",
    "Use 'refine' to narrow your search with different terms.",
    "Use 'view' to read note content or fragments.",
    "Use 'reset' to return to idle.",
  ],
  [WorkflowPlace.EDITING]: [
    "Use 'save' after making changes to move to review.",
    "Use 'back' to return to exploring without saving.",
    "Use 'edit' with append/prepend/replace to modify the note.",
    "Use 'view' to check the current note content.",
  ],
  [WorkflowPlace.REVIEWING]: [
    "Use 'done' to finish and return to idle.",
    "Use 'open_note' to edit another note.",
    "Use 'search' to start a new exploration.",
    "Review changes and verify they are correct.",
  ],
};

// ── Tool-specific hints ───────────────────────────────────────────

const TOOL_HINTS: Record<ToolName, Record<WorkflowPlace, string[]>> = {
  vault: {
    [WorkflowPlace.IDLE]: [
      "List notes to discover vault structure.",
      "Create a new note with 'vault create'.",
    ],
    [WorkflowPlace.EXPLORING]: [
      "Check if a note exists before opening.",
      "Get note metadata with 'vault stat'.",
    ],
    [WorkflowPlace.EDITING]: [
      "Read the full note before making changes.",
    ],
    [WorkflowPlace.REVIEWING]: [
      "Re-read the modified note to verify changes.",
    ],
  },
  edit: {
    [WorkflowPlace.IDLE]: [
      "Search for a note first, then open it for editing.",
    ],
    [WorkflowPlace.EXPLORING]: [
      "Open a note before editing it.",
    ],
    [WorkflowPlace.EDITING]: [
      "Use 'append' to add content under a heading.",
      "Use 'replace' to swap content at a heading or block.",
      "Use 'prepend' to insert content at the top of a section.",
      "Target by heading (title + depth) or block ID (^id).",
    ],
    [WorkflowPlace.REVIEWING]: [
      "Re-open the note if further edits are needed.",
    ],
  },
  view: {
    [WorkflowPlace.IDLE]: [
      "Search for notes to find relevant content.",
    ],
    [WorkflowPlace.EXPLORING]: [
      "Use fragment retrieval to read only relevant sections.",
      "View headings outline to understand note structure.",
    ],
    [WorkflowPlace.EDITING]: [
      "Preview a specific section before modifying it.",
    ],
    [WorkflowPlace.REVIEWING]: [
      "Read the full note to review all changes.",
    ],
  },
  workflow: {
    [WorkflowPlace.IDLE]: [
      "Check workflow status to see available actions.",
      "Start a new workflow with 'search'.",
    ],
    [WorkflowPlace.EXPLORING]: [
      "Transition to editing with 'open_note'.",
      "Refine search or reset to idle.",
    ],
    [WorkflowPlace.EDITING]: [
      "Save changes or go back to exploring.",
    ],
    [WorkflowPlace.REVIEWING]: [
      "Mark as done or continue editing.",
    ],
  },
  system: {
    [WorkflowPlace.IDLE]: [
      "Check system status and indexing progress.",
      "Trigger re-indexing if needed.",
    ],
    [WorkflowPlace.EXPLORING]: [
      "Check if the vector index is up to date.",
    ],
    [WorkflowPlace.EDITING]: [
      "System tools are available at any time.",
    ],
    [WorkflowPlace.REVIEWING]: [
      "Verify the index after editing notes.",
    ],
  },
};

// ── Engine ─────────────────────────────────────────────────────────

export class HintsEngine {
  /** Get general next-action hints based on workflow state. */
  static getHints(sm: WorkflowStateMachine): WorkflowHints {
    return {
      currentState: sm.currentPlace,
      nextActions: STATE_HINTS[sm.currentPlace],
      availableTransitions: sm.availableTransitions().map((t) => t.name),
    };
  }

  /** Get tool-specific hints based on workflow state. */
  static getToolHints(sm: WorkflowStateMachine, tool: ToolName): string[] {
    return TOOL_HINTS[tool][sm.currentPlace];
  }

  /** Wrap a tool response with contextual hints. */
  static formatResponse<T>(
    sm: WorkflowStateMachine,
    tool: ToolName,
    result: T,
  ): EnrichedResponse<T> {
    const workflowHints = HintsEngine.getHints(sm);
    const toolHints = HintsEngine.getToolHints(sm, tool);

    return {
      result,
      hints: {
        ...workflowHints,
        toolHints,
      },
    };
  }
}
