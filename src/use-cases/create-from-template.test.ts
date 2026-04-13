import { describe, it, expect, vi } from "vitest";
import type { IFileSystemAdapter } from "../domain/interfaces/file-system-adapter.js";
import type { ITemplateEngine } from "../domain/interfaces/template-engine.js";
import { NoteAlreadyExistsError, NoteNotFoundError } from "../domain/errors/index.js";
import { CreateFromTemplateUseCase } from "./create-from-template.js";

// ── Mocks ──────────────────────────────────────────────────────────

function mockFs(files: Record<string, string>): IFileSystemAdapter {
  return {
    listNotes: vi.fn(),
    readNote: vi.fn(async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new NoteNotFoundError(path);
      return content;
    }),
    writeNote: vi.fn(),
    deleteNote: vi.fn(),
    exists: vi.fn(async (path: string) => path in files),
    stat: vi.fn(),
  } as unknown as IFileSystemAdapter;
}

function mockTemplateEngine(): ITemplateEngine {
  return {
    render: vi.fn((template: string, variables: Record<string, string>) => {
      let result = template;
      for (const [key, value] of Object.entries(variables)) {
        result = result.replaceAll(`{{${key}}}`, value);
      }
      return result;
    }),
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("CreateFromTemplateUseCase", () => {
  it("reads template, renders variables, and writes to destination", async () => {
    const fs = mockFs({
      "templates/daily.md": "# {{title}}\n\nDate: {{date}}\n",
    });
    const engine = mockTemplateEngine();
    const useCase = new CreateFromTemplateUseCase(fs, engine);

    const result = await useCase.execute({
      templatePath: "templates/daily.md",
      destinationPath: "daily/2026-04-13.md",
      variables: { title: "Daily Note", date: "2026-04-13" },
    });

    expect(result.message).toContain("daily/2026-04-13.md");
    expect(engine.render).toHaveBeenCalledWith(
      "# {{title}}\n\nDate: {{date}}\n",
      { title: "Daily Note", date: "2026-04-13" },
    );
    expect(fs.writeNote).toHaveBeenCalledWith("daily/2026-04-13.md", "# Daily Note\n\nDate: 2026-04-13\n");
  });

  it("throws NoteAlreadyExistsError when destination file exists", async () => {
    const fs = mockFs({
      "templates/daily.md": "# {{title}}\n",
      "daily/2026-04-13.md": "# Existing content\n",
    });
    const engine = mockTemplateEngine();
    const useCase = new CreateFromTemplateUseCase(fs, engine);

    await expect(
      useCase.execute({
        templatePath: "templates/daily.md",
        destinationPath: "daily/2026-04-13.md",
        variables: { title: "Daily Note" },
      }),
    ).rejects.toThrow(NoteAlreadyExistsError);

    expect(fs.writeNote).not.toHaveBeenCalled();
  });

  it("propagates NoteNotFoundError when template does not exist", async () => {
    const fs = mockFs({});
    const engine = mockTemplateEngine();
    const useCase = new CreateFromTemplateUseCase(fs, engine);

    await expect(
      useCase.execute({
        templatePath: "templates/missing.md",
        destinationPath: "daily/2026-04-13.md",
        variables: { title: "Daily Note" },
      }),
    ).rejects.toThrow(NoteNotFoundError);

    expect(fs.writeNote).not.toHaveBeenCalled();
  });
});
