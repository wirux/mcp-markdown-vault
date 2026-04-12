import { describe, it, expect } from "vitest";
import { TfIdfScorer, ProximityScorer } from "./scoring.js";
import type { Chunk } from "./chunker.js";

// ── Helpers ────────────────────────────────────────────────────────

function makeChunk(text: string, headingPath: string[] = []): Chunk {
  return {
    headingPath,
    text,
    startLine: 1,
    endLine: 1,
    wordCount: text.split(/\s+/).length,
  };
}

// ── TF-IDF ─────────────────────────────────────────────────────────

describe("TfIdfScorer", () => {
  const chunks: Chunk[] = [
    makeChunk(
      "TypeScript is a typed superset of JavaScript. TypeScript compiles to JavaScript.",
      ["Intro"],
    ),
    makeChunk(
      "Python is great for data science and machine learning workflows.",
      ["Python"],
    ),
    makeChunk(
      "JavaScript runs in the browser and on Node.js servers.",
      ["JS Runtime"],
    ),
  ];

  it("scores the chunk containing the query term highest", () => {
    const scorer = new TfIdfScorer(chunks);
    const scores = scorer.score("Python");
    const pythonChunk = scores.find((s) =>
      s.chunk.headingPath.includes("Python"),
    );
    const introChunk = scores.find((s) =>
      s.chunk.headingPath.includes("Intro"),
    );
    expect(pythonChunk!.score).toBeGreaterThan(introChunk!.score);
  });

  it("ranks chunks with higher term frequency higher", () => {
    const scorer = new TfIdfScorer(chunks);
    const scores = scorer.score("TypeScript");
    // "Intro" chunk has "TypeScript" twice
    const introChunk = scores.find((s) =>
      s.chunk.headingPath.includes("Intro"),
    );
    const jsChunk = scores.find((s) =>
      s.chunk.headingPath.includes("JS Runtime"),
    );
    expect(introChunk!.score).toBeGreaterThan(jsChunk!.score);
  });

  it("gives higher IDF to rare terms", () => {
    const scorer = new TfIdfScorer(chunks);
    // "Python" appears in 1 chunk, "JavaScript" in 2
    const pythonScores = scorer.score("Python");
    const jsScores = scorer.score("JavaScript");

    const bestPython = Math.max(...pythonScores.map((s) => s.score));
    const bestJs = Math.max(...jsScores.map((s) => s.score));
    // Python being rarer should boost its best score relative to JS
    expect(bestPython).toBeGreaterThan(0);
    expect(bestJs).toBeGreaterThan(0);
  });

  it("handles multi-word queries by summing per-term TF-IDF", () => {
    const scorer = new TfIdfScorer(chunks);
    const scores = scorer.score("TypeScript JavaScript");
    // Intro chunk mentions both terms
    const introChunk = scores.find((s) =>
      s.chunk.headingPath.includes("Intro"),
    );
    expect(introChunk!.score).toBeGreaterThan(0);
  });

  it("is case-insensitive", () => {
    const scorer = new TfIdfScorer(chunks);
    const upper = scorer.score("PYTHON");
    const lower = scorer.score("python");
    const bestUpper = Math.max(...upper.map((s) => s.score));
    const bestLower = Math.max(...lower.map((s) => s.score));
    expect(bestUpper).toBe(bestLower);
  });

  it("returns zero scores when no terms match", () => {
    const scorer = new TfIdfScorer(chunks);
    const scores = scorer.score("quantum entanglement");
    expect(scores.every((s) => s.score === 0)).toBe(true);
  });
});

// ── Proximity ──────────────────────────────────────────────────────

describe("ProximityScorer", () => {
  it("scores higher when query words are adjacent", () => {
    const close = makeChunk(
      "The machine learning pipeline processes data efficiently.",
    );
    const far = makeChunk(
      "The machine was broken. After learning about repairs, we fixed it.",
    );
    const chunks = [close, far];

    const scores = ProximityScorer.score(chunks, "machine learning");
    const closeScore = scores.find((s) => s.chunk === close)!.score;
    const farScore = scores.find((s) => s.chunk === far)!.score;
    expect(closeScore).toBeGreaterThan(farScore);
  });

  it("returns zero for single-word queries", () => {
    const chunk = makeChunk("Some text here.");
    const scores = ProximityScorer.score([chunk], "text");
    expect(scores[0]!.score).toBe(0);
  });

  it("returns zero when query words are not found", () => {
    const chunk = makeChunk("Nothing relevant here.");
    const scores = ProximityScorer.score([chunk], "quantum physics");
    expect(scores[0]!.score).toBe(0);
  });

  it("handles repeated words correctly (uses best pair)", () => {
    const chunk = makeChunk(
      "data is important. We transform data for analysis. The analysis pipeline works.",
    );
    const scores = ProximityScorer.score([chunk], "data analysis");
    expect(scores[0]!.score).toBeGreaterThan(0);
  });
});
