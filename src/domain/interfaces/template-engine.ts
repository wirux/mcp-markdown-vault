/**
 * Port interface for template rendering.
 *
 * Implementations replace placeholder variables (e.g. `{{key}}`)
 * in a template string with the provided values.
 */
export interface ITemplateEngine {
  render(templateContent: string, variables: Record<string, string>): string;
}
