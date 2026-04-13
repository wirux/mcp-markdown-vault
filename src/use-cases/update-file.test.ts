import { describe, it, expect, vi } from "vitest";
import type { IFileSystemAdapter } from "../domain/interfaces/file-system-adapter.js";
import { UpdateFileUseCase } from "./update-file.js";

function mockFs(): IFileSystemAdapter {
  return {
    listNotes: vi.fn(),
    readNote: vi.fn(),
    writeNote: vi.fn().mockResolvedValue(undefined),
    deleteNote: vi.fn(),
    exists: vi.fn(),
    stat: vi.fn(),
  } as unknown as IFileSystemAdapter;
}

describe("UpdateFileUseCase", () => {
  it("calls writeNote with overwrite=true", async () => {
    const fs = mockFs();
    const useCase = new UpdateFileUseCase(fs);

    const result = await useCase.execute({
      path: "notes/hello.md",
      content: "# Updated\n\nNew content.\n",
    });

    expect(fs.writeNote).toHaveBeenCalledWith(
      "notes/hello.md",
      "# Updated\n\nNew content.\n",
      true,
    );
    expect(result.message).toContain("notes/hello.md");
  });

  it("propagates errors from the file system", async () => {
    const fs = mockFs();
    (fs.writeNote as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("disk full"),
    );
    const useCase = new UpdateFileUseCase(fs);

    await expect(
      useCase.execute({ path: "x.md", content: "data" }),
    ).rejects.toThrow("disk full");
  });
});
