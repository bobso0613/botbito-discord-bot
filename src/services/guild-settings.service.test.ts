import { describe, expect, it, jest } from "@jest/globals";
import type { GuildSettings } from "../types/discord-settings.js";
import {
  COOLDOWN_INSTANCE_TYPES,
  MULTIPLIER_INSTANCE_TYPES,
} from "../constants/cooldowns.js";

const files = new Map<string, string>();
const mkdir = jest.fn();
const readFile = jest.fn(async (path: string) => {
  const value = files.get(path);
  if (value === undefined) {
    const error = Object.assign(new Error("missing"), { code: "ENOENT" });
    throw error;
  }
  return value;
});
const writeFile = jest.fn(async (path: string, content: string) => {
  files.set(path, content);
});
const rename = jest.fn(async (from: string, to: string) => {
  const content = files.get(from);
  if (content === undefined) throw new Error("missing temporary file");
  files.delete(from);
  files.set(to, content);
});
const reloadDiscordSettings = jest.fn();

jest.unstable_mockModule("node:crypto", () => ({
  randomUUID: () => "test-uuid",
}));
jest.unstable_mockModule("node:fs/promises", () => ({
  mkdir,
  readFile,
  rename,
  writeFile,
}));
jest.unstable_mockModule("../config/discord-settings.js", () => ({
  reloadDiscordSettings,
}));

const { ensureGuildSettings, updateGuildScheduleSource } =
  await import("./guild-settings.service.js");

const getPath = (guildId: string): string =>
  `${process.cwd()}\\private\\guild-settings\\${guildId}.json`;

describe("guild settings service", () => {
  beforeEach(() => {
    files.clear();
    jest.clearAllMocks();
  });

  it("creates the requested empty configuration for a new guild", async () => {
    await ensureGuildSettings("new-guild");

    expect(JSON.parse(files.get(getPath("new-guild")) ?? "")).toEqual({
      guildScheduleSource: {
        categoryIds: [],
        excludedChannelIds: [],
        roleRestrictedChannels: {},
        scheduleTextChannelIds: [],
      },
      guildIcons: { DEV: "", PROD: "" },
      cooldownInstanceTypes: COOLDOWN_INSTANCE_TYPES,
      multiplierInstanceTypes: [...MULTIPLIER_INSTANCE_TYPES],
    });
    expect(mkdir).toHaveBeenCalled();
    expect(reloadDiscordSettings).toHaveBeenCalledTimes(1);
  });

  it("preserves existing settings when ensuring an existing guild", async () => {
    const existing: GuildSettings = {
      guildScheduleSource: {
        categoryIds: ["category-id"],
        excludedChannelIds: ["excluded-channel-id"],
        roleRestrictedChannels: { "private-channel-id": "role-id" },
        scheduleTextChannelIds: ["schedule-channel-id"],
      },
      guildIcons: { DEV: "dev-icon", PROD: "prod-icon" },
      cooldownInstanceTypes: COOLDOWN_INSTANCE_TYPES.map((type) => ({
        ...type,
        keywords: [...type.keywords],
      })),
      multiplierInstanceTypes: [...MULTIPLIER_INSTANCE_TYPES],
    };
    files.set(getPath("existing-guild"), JSON.stringify(existing));

    await ensureGuildSettings("existing-guild");

    expect(JSON.parse(files.get(getPath("existing-guild")) ?? "")).toEqual(
      existing,
    );
  });

  it("updates only the schedule source selected by a guild command", async () => {
    await updateGuildScheduleSource("updated-guild", (source) => {
      source.scheduleTextChannelIds = ["schedule-channel-id"];
      source.roleRestrictedChannels = { "private-channel-id": "role-id" };
    });

    const settings = JSON.parse(
      files.get(getPath("updated-guild")) ?? "",
    ) as GuildSettings;
    expect(settings.guildScheduleSource).toEqual({
      categoryIds: [],
      excludedChannelIds: [],
      roleRestrictedChannels: { "private-channel-id": "role-id" },
      scheduleTextChannelIds: ["schedule-channel-id"],
    });
    expect(settings.guildIcons).toEqual({ DEV: "", PROD: "" });
    expect(reloadDiscordSettings).toHaveBeenCalledTimes(1);
  });
});
