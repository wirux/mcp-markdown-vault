import { describe, it, expect } from "vitest";
import { RegexTemplateEngine } from "./regex-template-engine.js";

describe("RegexTemplateEngine", () => {
  const engine = new RegexTemplateEngine();

  it("replaces all matching placeholders with variable values", () => {
    const template = "Hello {{name}}, today is {{date}}";
    const result = engine.render(template, { name: "AI", date: "Monday" });
    expect(result).toBe("Hello AI, today is Monday");
  });

  it("leaves unmatched placeholders intact", () => {
    const template = "Hello {{name}}, your role is {{role}}";
    const result = engine.render(template, { name: "AI" });
    expect(result).toBe("Hello AI, your role is {{role}}");
  });

  it("handles whitespace inside braces", () => {
    const template = "Hello {{ name }}, today is {{  date  }}";
    const result = engine.render(template, { name: "AI", date: "Monday" });
    expect(result).toBe("Hello AI, today is Monday");
  });

  it("returns template unchanged when no variables provided", () => {
    const template = "# {{title}}\n\nContent here.";
    const result = engine.render(template, {});
    expect(result).toBe("# {{title}}\n\nContent here.");
  });

  it("replaces multiple occurrences of the same variable", () => {
    const template = "{{name}} is great. I love {{name}}.";
    const result = engine.render(template, { name: "AI" });
    expect(result).toBe("AI is great. I love AI.");
  });
});
