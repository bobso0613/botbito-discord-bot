import { describe, expect, it, afterEach, jest } from "@jest/globals";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InstanceType } from "../constants/cooldowns.js";
import { addMissingCooldownInitials as inferInitials } from "../utils/cooldown-initials.js";
import {
  addMissingCooldownInitials,
  retrofitGuildCooldownInitials,
} from "./retrofit-cooldown-initials.js";

const buildType = (keywords: string[], initials?: string): InstanceType => ({
  name: "Test Instance",
  keywords,
  maxAttempts: 1,
  emoji: "x",
  ...(initials !== undefined ? { initials } : {}),
});
const temporaryDirectories: string[] = [];
const createDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "botbito-initials-"));
  temporaryDirectories.push(directory);
  return directory;
};
afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("retrofit cooldown initials", () => {
  it("defaults to the bot working directory independently of the deployed script location", async () => {
    const root = await createDirectory();
    const directory = join(root, "private", "guild-settings");
    await mkdir(directory, { recursive: true });
    const path = join(directory, "guild.json");
    const source = JSON.stringify({
      cooldownInstanceTypes: [buildType(["ET"])],
    });
    await writeFile(path, source);
    const cwd = jest.spyOn(process, "cwd").mockReturnValue(root);
    try {
      await expect(
        retrofitGuildCooldownInitials(undefined, true),
      ).resolves.toEqual([
        { path, changes: [{ name: "Test Instance", initials: "ET" }] },
      ]);
      expect(await readFile(path, "utf8")).toBe(source);
      expect(await readdir(directory)).toEqual(["guild.json"]);
    } finally {
      cwd.mockRestore();
    }
  });

  it("preserves the script's public helper export after extraction", () => {
    expect(addMissingCooldownInitials).toBe(inferInitials);
  });

  it("dry-runs without changing files or creating backups", async () => {
    const directory = await createDirectory();
    const path = join(directory, "guild.json");
    const source = JSON.stringify({
      cooldownInstanceTypes: [buildType(["ET"])],
    });
    await writeFile(path, source);
    const result = await retrofitGuildCooldownInitials(directory, true);
    expect(result).toEqual([
      { path, changes: [{ name: "Test Instance", initials: "ET" }] },
    ]);
    expect(await readFile(path, "utf8")).toBe(source);
    expect(await readdir(directory)).toEqual(["guild.json"]);
  });

  it("backs up originals, preserves unrelated settings, and is idempotent", async () => {
    const directory = await createDirectory();
    const path = join(directory, "guild.json");
    const settings = {
      payoutSheetChannelId: "forum-id",
      guildIcons: { DEV: "icon" },
      cooldownInstanceTypes: [
        buildType(["Long Name", "ET"]),
        buildType(["Long Name"]),
      ],
    };
    const source = JSON.stringify(settings);
    await writeFile(path, source);
    expect(await retrofitGuildCooldownInitials(directory)).toHaveLength(1);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      ...settings,
      cooldownInstanceTypes: [
        { ...settings.cooldownInstanceTypes[0], initials: "ET" },
        settings.cooldownInstanceTypes[1],
      ],
    });
    expect(await readFile(`${path}.initials.bak`, "utf8")).toBe(source);
    const migrated = await readFile(path, "utf8");
    expect(await retrofitGuildCooldownInitials(directory)).toEqual([]);
    expect(await readFile(path, "utf8")).toBe(migrated);
    expect(await readFile(`${path}.initials.bak`, "utf8")).toBe(source);
  });

  it("validates JSON files before applying any changes", async () => {
    const directory = await createDirectory();
    const path = join(directory, "guild.json");
    const source = JSON.stringify({
      cooldownInstanceTypes: [buildType(["ET"])],
    });
    await writeFile(path, source);
    await writeFile(join(directory, "invalid.json"), "invalid JSON");
    await expect(retrofitGuildCooldownInitials(directory)).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe(source);
  });
});
