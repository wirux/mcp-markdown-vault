import type { ITemplateEngine } from "../domain/interfaces/template-engine.js";

/**
 * Simple regex-based template engine.
 *
 * Replaces `{{key}}` placeholders (with optional inner whitespace)
 * with values from the provided variables map.
 * Unmatched placeholders are left intact.
 */
export class RegexTemplateEngine implements ITemplateEngine {
  private static readonly PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

  render(templateContent: string, variables: Record<string, string>): string {
    return templateContent.replace(RegexTemplateEngine.PLACEHOLDER, (match, key: string) => {
      return key in variables ? variables[key]! : match;
    });
  }
}
