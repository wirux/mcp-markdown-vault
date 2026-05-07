import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockWatch, mockOn, mockClose } = vi.hoisted(() => {
  return {
    mockWatch: vi.fn(),
    mockOn: vi.fn(),
    mockClose: vi.fn(),
  };
});

vi.mock("chokidar", () => ({
  default: {
    watch: mockWatch,
  },
}));

import { ChokidarFileWatcher } from "./chokidar-file-watcher.js";

describe("ChokidarFileWatcher", () => {
  beforeEach(() => {
    mockWatch.mockReset();
    mockOn.mockReset();
    mockClose.mockReset();
    mockClose.mockResolvedValue(undefined);
    mockWatch.mockReturnValue({
      on: mockOn,
      close: mockClose,
    });
  });

  it("starts chokidar with markdown-specific defaults", () => {
    const watcher = new ChokidarFileWatcher();

    watcher.watch("/vault", { persistent: true });

    expect(mockWatch).toHaveBeenCalledOnce();
    expect(mockWatch).toHaveBeenCalledWith(
      "/vault",
      expect.objectContaining({
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 100 },
        ignored: expect.any(Function),
      }),
    );

    const args = mockWatch.mock.calls[0];
    const options = args?.[1] as { ignored: (filePath: string) => boolean };
    expect(options.ignored("/vault/folder")).toBe(false);
    expect(options.ignored("/vault/note.md")).toBe(false);
    expect(options.ignored("/vault/note.txt")).toBe(true);
  });

  it("forwards event handlers to the active chokidar watcher", () => {
    const watcher = new ChokidarFileWatcher();
    const handler = vi.fn();

    watcher.watch("/vault");
    watcher.on("change", handler);

    expect(mockOn).toHaveBeenCalledWith("change", handler);
  });

  it("closes the active chokidar watcher", async () => {
    const watcher = new ChokidarFileWatcher();

    watcher.watch("/vault");
    await watcher.close();

    expect(mockClose).toHaveBeenCalledOnce();
  });
});
