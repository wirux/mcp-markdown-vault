import { describe, it, expect } from "vitest";
import { computeEvidenceHash, extractStoredHash } from "./evidence-hash.js";
import type { VaultEvidence } from "./evidence-hash.js";

describe("computeEvidenceHash", () => {
  it("returns a 64-character hex string", () => {
    const evidence: VaultEvidence = {
      totalFiles: 5,
      directories: ["notes", "projects"],
      tags: ["alpha", "beta"],
      titles: ["Note A", "Note B"],
    };
    const hash = computeEvidenceHash(evidence);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces the same hash regardless of array insertion order", () => {
    const e1: VaultEvidence = {
      totalFiles: 3,
      directories: ["a", "b"],
      tags: ["x", "y"],
      titles: ["T1", "T2"],
    };
    const e2: VaultEvidence = {
      totalFiles: 3,
      directories: ["b", "a"],
      tags: ["y", "x"],
      titles: ["T2", "T1"],
    };
    expect(computeEvidenceHash(e1)).toBe(computeEvidenceHash(e2));
  });

  it("produces different hashes for different evidence", () => {
    const e1: VaultEvidence = { totalFiles: 1, directories: [], tags: [], titles: [] };
    const e2: VaultEvidence = { totalFiles: 2, directories: [], tags: [], titles: [] };
    expect(computeEvidenceHash(e1)).not.toBe(computeEvidenceHash(e2));
  });

  it("is stable across multiple calls with same input", () => {
    const evidence: VaultEvidence = {
      totalFiles: 10,
      directories: ["docs"],
      tags: ["tag1"],
      titles: ["My Note"],
    };
    expect(computeEvidenceHash(evidence)).toBe(computeEvidenceHash(evidence));
  });
});

describe("extractStoredHash", () => {
  it("returns the evidence_hash from valid frontmatter", () => {
    const content = `---\nevidence_hash: abc123def456\nother: value\n---\n\n# Body`;
    expect(extractStoredHash(content)).toBe("abc123def456");
  });

  it("returns undefined when frontmatter is missing", () => {
    expect(extractStoredHash("# No frontmatter")).toBeUndefined();
  });

  it("returns undefined when evidence_hash field is absent", () => {
    const content = `---\nvault_scope: some scope\n---\n\n# Body`;
    expect(extractStoredHash(content)).toBeUndefined();
  });

  it("returns undefined when frontmatter is malformed YAML", () => {
    const content = `---\n: invalid: yaml: [\n---\n\n# Body`;
    expect(extractStoredHash(content)).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(extractStoredHash("")).toBeUndefined();
  });

  it("trims whitespace from the hash value", () => {
    const content = `---\nevidence_hash:   abc123  \n---\n\n# Body`;
    expect(extractStoredHash(content)).toBe("abc123");
  });
});
