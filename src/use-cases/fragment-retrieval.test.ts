import { describe, it, expect } from "vitest";
import { FragmentRetriever } from "./fragment-retrieval.js";

const retriever = new FragmentRetriever();

// ── Basic retrieval ────────────────────────────────────────────────

describe("FragmentRetriever", () => {
  const DOC = `# Introduction

This document covers various topics in software engineering.

## Database Design

Relational databases use SQL for querying structured data.
Normalization reduces redundancy through normal forms.

## API Design

RESTful APIs use HTTP methods like GET, POST, PUT, DELETE.
Endpoints should be resource-oriented and use proper status codes.

## Testing Strategies

Unit tests verify individual functions in isolation.
Integration tests check that components work together.
End-to-end tests validate the full user workflow.
`;

  it("retrieves the most relevant fragment for a query", () => {
    const results = retriever.retrieve(DOC, "HTTP methods REST endpoints");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.chunk.headingPath).toContain("API Design");
  });

  it("retrieves database-related chunk for a database query", () => {
    const results = retriever.retrieve(DOC, "SQL normalization relational");
    expect(results[0]!.chunk.headingPath).toContain("Database Design");
  });

  it("returns multiple ranked results", () => {
    const results = retriever.retrieve(DOC, "testing");
    expect(results.length).toBeGreaterThanOrEqual(1);
    // Results should be sorted by score descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.score).toBeLessThanOrEqual(results[i - 1]!.score);
    }
  });

  it("respects maxChunks limit", () => {
    const results = retriever.retrieve(DOC, "testing", { maxChunks: 1 });
    expect(results.length).toBe(1);
  });

  it("returns empty array for no-match queries", () => {
    const results = retriever.retrieve(DOC, "quantum entanglement spacetime");
    expect(results.length).toBe(0);
  });

  it("includes heading path breadcrumbs in results", () => {
    const results = retriever.retrieve(DOC, "unit tests isolation");
    expect(results[0]!.chunk.headingPath.length).toBeGreaterThan(0);
  });
});

// ── PLAN.md critical test: 10,000-word note ────────────────────────

describe("FragmentRetriever — 10,000-word note", () => {
  /**
   * Build a ~10,000-word document with 20 sections of ~500 words each.
   * ONE section is about "quantum computing" — the rest are filler about
   * various mundane topics to dilute the signal.
   */
  function build10kDocument(): string {
    const fillerTopics = [
      "gardening tips for growing tomatoes in small spaces",
      "the history of bread baking across different cultures",
      "techniques for watercolor painting and color mixing",
      "introduction to woodworking and basic joinery methods",
      "a guide to birdwatching in temperate forest regions",
      "the basics of home plumbing repair and maintenance",
      "understanding weather patterns and atmospheric pressure",
      "principles of sustainable agriculture and crop rotation",
      "the evolution of classical music from baroque to romantic",
      "a beginner guide to knitting patterns and yarn selection",
      "the art of Japanese tea ceremony and its cultural significance",
      "fundamentals of amateur astronomy and telescope selection",
      "traditional fermentation methods for vegetables and dairy",
      "basics of pottery throwing on a wheel and glazing techniques",
      "understanding soil composition and garden fertilization",
      "a history of mapmaking and cartographic projections",
      "the science of sourdough starters and bread fermentation",
      "introduction to beekeeping and hive management",
      "principles of landscape photography and composition rules",
    ];

    const sections: string[] = ["# Comprehensive Reference Document\n"];

    // Generate ~500 words of filler for each topic
    for (let i = 0; i < fillerTopics.length; i++) {
      const topic = fillerTopics[i]!;
      const sectionTitle = topic.charAt(0).toUpperCase() + topic.slice(1);
      sections.push(`\n## ${sectionTitle}\n`);
      sections.push(generateFiller(topic, 500));
    }

    // Insert the target section in the middle
    const targetIdx = 10;
    const quantumSection = `
## Quantum Computing and Qubits

Quantum computing represents a fundamentally different approach to computation.
Unlike classical computers that use bits representing zero or one, quantum computers
use quantum bits or qubits that can exist in superposition. Superposition allows a
qubit to represent both zero and one simultaneously until measured. This property
enables quantum computers to explore many solutions in parallel.

Entanglement is another key quantum phenomenon where two qubits become correlated
such that measuring one instantly determines the state of the other regardless of
distance. Quantum gates manipulate qubits through operations analogous to classical
logic gates but operating on probability amplitudes.

Major algorithms like Shor's algorithm for factoring large numbers and Grover's
algorithm for searching unsorted databases demonstrate quantum advantage over
classical approaches. Quantum error correction remains a significant challenge
because qubits are extremely sensitive to environmental noise and decoherence.

Current quantum processors from companies like IBM and Google have demonstrated
quantum supremacy on specific tasks. However practical large-scale fault-tolerant
quantum computing remains years away. The field requires advances in qubit
coherence times, error correction codes, and cryogenic engineering to achieve
commercially viable quantum computers.

Quantum annealing represents an alternative approach used by systems like those
from D-Wave. These specialized processors solve optimization problems by finding
the lowest energy state of a quantum system. While not universal quantum computers
they have shown promise for specific combinatorial optimization tasks.
`;

    sections.splice(targetIdx, 0, quantumSection);

    return sections.join("\n");
  }

  function generateFiller(topic: string, targetWords: number): string {
    const words = topic.split(/\s+/);
    const sentences: string[] = [];
    let wordCount = 0;

    while (wordCount < targetWords) {
      // Generate varied sentences from the topic words
      const templates = [
        `When considering ${topic}, it is important to understand the fundamentals that practitioners have developed over many years of careful study and experimentation in this particular field of endeavor.`,
        `Experienced practitioners of ${words.slice(0, 3).join(" ")} often emphasize the importance of patience and systematic approaches when working through the various challenges that arise during practice.`,
        `The relationship between ${words[0]} and ${words[words.length - 1]} has been studied extensively by researchers who have published numerous papers on the subject in academic journals and professional publications.`,
        `Understanding the core principles of ${words.slice(0, 2).join(" ")} requires dedication and consistent practice over extended periods of time to develop the necessary skills and intuition.`,
        `Modern approaches to ${topic} have evolved significantly from traditional methods, incorporating new technologies and research findings that have expanded our understanding considerably.`,
      ];

      const sentence = templates[sentences.length % templates.length]!;
      sentences.push(sentence);
      wordCount += sentence.split(/\s+/).length;
    }

    return sentences.join(" ") + "\n";
  }

  it("retrieves only the relevant ~500-word quantum chunk from a 10,000-word document", () => {
    const doc = build10kDocument();

    // Verify the document is roughly 10,000 words
    const totalWords = doc.split(/\s+/).length;
    expect(totalWords).toBeGreaterThan(8000);
    expect(totalWords).toBeLessThan(15000);

    const results = retriever.retrieve(
      doc,
      "quantum computing qubits superposition entanglement",
      { maxChunks: 3 },
    );

    // The top result must be the quantum section
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.chunk.headingPath).toContain(
      "Quantum Computing and Qubits",
    );

    // The quantum chunk should be ~500 words, not 10,000
    expect(results[0]!.chunk.wordCount).toBeLessThan(1000);
    expect(results[0]!.chunk.wordCount).toBeGreaterThan(50);

    // Verify we're returning a small fraction of the document
    const returnedWords = results.reduce(
      (sum, r) => sum + r.chunk.wordCount,
      0,
    );
    expect(returnedWords).toBeLessThan(totalWords * 0.2);
  });

  it("ranks the quantum section well above filler even with an abstract query", () => {
    const doc = build10kDocument();
    const results = retriever.retrieve(doc, "Shor algorithm factoring", {
      maxChunks: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.chunk.headingPath).toContain(
      "Quantum Computing and Qubits",
    );
    // Top score should be significantly higher than the second result
    if (results.length > 1) {
      expect(results[0]!.score).toBeGreaterThan(results[1]!.score * 1.5);
    }
  });
});
