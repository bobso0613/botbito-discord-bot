import { jest } from "@jest/globals";
import type { SignupSheet } from "../types/signup-sheet.js";

const readFile =
  jest.fn<(path: string, encoding?: string) => Promise<string>>();
const writeFile =
  jest.fn<(path: string, data: string, encoding?: string) => Promise<void>>();
const mkdir =
  jest.fn<
    (
      path: string,
      options?: { recursive?: boolean },
    ) => Promise<string | undefined>
  >();
const rename = jest.fn<(oldPath: string, newPath: string) => Promise<void>>();
const randomUUID = jest.fn<() => string>(() => "fixed-uuid");

jest.unstable_mockModule("node:fs/promises", () => ({
  readFile,
  writeFile,
  mkdir,
  rename,
}));
jest.unstable_mockModule("node:crypto", () => ({ randomUUID }));

const { getSignupSheet, saveSignupSheet, deleteSignupSheet } =
  await import("./signup-sheet.service.js");

const buildSheet = (overrides: Partial<SignupSheet> = {}): SignupSheet => ({
  guildId: "guild-1",
  channelId: "channel-1",
  title: "Test Run",
  organizerName: "Organizer",
  organizerAvatarUrl: "https://example.com/organizer.png",
  partySizes: [1],
  slots: [],
  reserves: [],
  notes: null,
  thumbnailUrl: null,
  color: null,
  instanceType: null,
  timestamp: null,
  scheduleTimezone: null,
  serverTimezone: null,
  ...overrides,
});

describe("signup-sheet service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    randomUUID.mockReturnValue("fixed-uuid");
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);
    rename.mockResolvedValue(undefined);
  });

  describe("getSignupSheet", () => {
    it("returns null when the storage file doesn't exist yet", async () => {
      readFile.mockRejectedValue(
        Object.assign(new Error("missing"), { code: "ENOENT" }),
      );

      await expect(getSignupSheet("guild-1", "channel-1")).resolves.toBeNull();
    });

    it("rethrows unexpected read errors", async () => {
      readFile.mockRejectedValue(
        Object.assign(new Error("boom"), { code: "EACCES" }),
      );

      await expect(getSignupSheet("guild-1", "channel-1")).rejects.toThrow(
        "boom",
      );
    });

    it("returns the sheet stored under the channel key", async () => {
      const sheet = buildSheet();
      readFile.mockResolvedValue(JSON.stringify({ "channel-1": sheet }));

      await expect(getSignupSheet("guild-1", "channel-1")).resolves.toEqual(
        sheet,
      );
    });

    it("returns null when no sheet is stored for that key", async () => {
      readFile.mockResolvedValue(JSON.stringify({}));

      await expect(getSignupSheet("guild-1", "channel-1")).resolves.toBeNull();
    });
  });

  describe("saveSignupSheet", () => {
    it("writes to a temp file then renames it into place, preserving other channels in the guild", async () => {
      const existingSheet = buildSheet({
        guildId: "guild-1",
        channelId: "channel-2",
      });
      readFile.mockResolvedValue(
        JSON.stringify({ "channel-2": existingSheet }),
      );
      const newSheet = buildSheet();

      await saveSignupSheet(newSheet);

      expect(mkdir).toHaveBeenCalledWith(expect.any(String), {
        recursive: true,
      });
      const [temporaryPath, contents] = writeFile.mock.calls[0] as [
        string,
        string,
      ];
      expect(temporaryPath).toContain("fixed-uuid.tmp");
      expect(JSON.parse(contents)).toEqual({
        "channel-2": existingSheet,
        "channel-1": newSheet,
      });
      expect(rename).toHaveBeenCalledWith(
        temporaryPath,
        expect.stringContaining("guild-1.json"),
      );
    });

    it("overwrites an existing sheet for the same channel in the guild", async () => {
      const original = buildSheet({ title: "Original" });
      readFile.mockResolvedValue(JSON.stringify({ "channel-1": original }));
      const updated = buildSheet({ title: "Updated" });

      await saveSignupSheet(updated);

      const [, contents] = writeFile.mock.calls[0] as [string, string];
      expect(JSON.parse(contents)).toEqual({
        "channel-1": updated,
      });
    });
  });

  describe("deleteSignupSheet", () => {
    it("removes the sheet for the given channel in the guild", async () => {
      const sheet = buildSheet();
      readFile.mockResolvedValue(JSON.stringify({ "channel-1": sheet }));

      await deleteSignupSheet("guild-1", "channel-1");

      const [, contents] = writeFile.mock.calls[0] as [string, string];
      expect(JSON.parse(contents)).toEqual({});
    });

    it("does not throw when there is nothing to delete", async () => {
      readFile.mockResolvedValue(JSON.stringify({}));

      await expect(
        deleteSignupSheet("guild-1", "channel-1"),
      ).resolves.toBeUndefined();
    });
  });
});
