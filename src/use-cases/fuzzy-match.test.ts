import { describe, it, expect } from "vitest";
import { FuzzyMatcher } from "./fuzzy-match.js";

describe("FuzzyMatcher", () => {
  const HEADINGS = [
    "Introduction",
    "Getting Started",
    "API Reference",
    "Configuration Options",
    "Troubleshooting Guide",
    "FAQ",
  ];

  describe("exact match", () => {
    it("returns a perfect match with similarity 1.0", () => {
      const result = FuzzyMatcher.bestMatch("Introduction", HEADINGS);
      expect(result).not.toBeNull();
      expect(result!.match).toBe("Introduction");
      expect(result!.similarity).toBe(1);
    });
  });

  describe("case-insensitive matching", () => {
    it("matches regardless of case", () => {
      const result = FuzzyMatcher.bestMatch("introduction", HEADINGS);
      expect(result).not.toBeNull();
      expect(result!.match).toBe("Introduction");
      expect(result!.similarity).toBe(1);
    });

    it("matches all-caps", () => {
      const result = FuzzyMatcher.bestMatch("FAQ", HEADINGS);
      expect(result!.match).toBe("FAQ");
    });
  });

  describe("typo resilience", () => {
    it("matches with one character typo", () => {
      const result = FuzzyMatcher.bestMatch("Introducion", HEADINGS);
      expect(result).not.toBeNull();
      expect(result!.match).toBe("Introduction");
      expect(result!.similarity).toBeGreaterThan(0.8);
    });

    it("matches with transposed characters", () => {
      const result = FuzzyMatcher.bestMatch("Cofniguration Options", HEADINGS);
      expect(result).not.toBeNull();
      expect(result!.match).toBe("Configuration Options");
      expect(result!.similarity).toBeGreaterThan(0.8);
    });

    it("matches with missing character", () => {
      const result = FuzzyMatcher.bestMatch("Gettin Started", HEADINGS);
      expect(result).not.toBeNull();
      expect(result!.match).toBe("Getting Started");
      expect(result!.similarity).toBeGreaterThan(0.8);
    });

    it("matches with extra character", () => {
      const result = FuzzyMatcher.bestMatch("Troublesshooting Guide", HEADINGS);
      expect(result).not.toBeNull();
      expect(result!.match).toBe("Troubleshooting Guide");
      expect(result!.similarity).toBeGreaterThan(0.8);
    });
  });

  describe("threshold", () => {
    it("returns null when no match exceeds threshold", () => {
      const result = FuzzyMatcher.bestMatch(
        "completely different text",
        HEADINGS,
        0.5,
      );
      expect(result).toBeNull();
    });

    it("returns match when above custom threshold", () => {
      const result = FuzzyMatcher.bestMatch(
        "API Ref",
        HEADINGS,
        0.4,
      );
      expect(result).not.toBeNull();
      expect(result!.match).toBe("API Reference");
    });
  });

  describe("ranking", () => {
    it("returns the best match among multiple candidates", () => {
      const candidates = ["apple", "application", "apply"];
      const result = FuzzyMatcher.bestMatch("aplicaton", candidates);
      expect(result).not.toBeNull();
      expect(result!.match).toBe("application");
    });
  });

  describe("allMatches", () => {
    it("returns all matches above threshold, sorted by similarity", () => {
      const candidates = ["cat", "car", "bat", "cart"];
      const results = FuzzyMatcher.allMatches("car", candidates, 0.5);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]!.match).toBe("car");
      expect(results[0]!.similarity).toBe(1);

      // Should be sorted descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i]!.similarity).toBeLessThanOrEqual(
          results[i - 1]!.similarity,
        );
      }
    });

    it("returns empty for no matches above threshold", () => {
      const results = FuzzyMatcher.allMatches("xyz", ["abc", "def"], 0.8);
      expect(results).toEqual([]);
    });
  });

  describe("Levenshtein distance", () => {
    it("returns 0 for identical strings", () => {
      expect(FuzzyMatcher.distance("hello", "hello")).toBe(0);
    });

    it("returns correct distance for insertions", () => {
      expect(FuzzyMatcher.distance("cat", "cats")).toBe(1);
    });

    it("returns correct distance for deletions", () => {
      expect(FuzzyMatcher.distance("cats", "cat")).toBe(1);
    });

    it("returns correct distance for substitutions", () => {
      expect(FuzzyMatcher.distance("cat", "car")).toBe(1);
    });

    it("returns string length for empty vs non-empty", () => {
      expect(FuzzyMatcher.distance("", "hello")).toBe(5);
      expect(FuzzyMatcher.distance("hello", "")).toBe(5);
    });
  });
});
