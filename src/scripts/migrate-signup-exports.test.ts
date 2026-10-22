import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ChannelType, Routes } from "discord.js";
import {
  migrateSignupExports,
  parseSignupExportMigrationOptions,
} from "./migrate-signup-exports.js";

const directories: string[] = [];
const createDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "botbito-exports-"));
  directories.push(directory);
  return directory;
};
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const thread = (id: string, name = "\u23f3 Run", parent_id = "forum") => ({
  id,
  name,
  parent_id,
});
const createRest = (threads = [thread("legacy")]) => ({
  get: jest.fn(async (route: string, _options?: unknown): Promise<unknown> => {
    if (route === Routes.channel("forum"))
      return { type: ChannelType.GuildForum, guild_id: "guild" };
    if (route === Routes.guildActiveThreads("guild")) return { threads };
    return [{ id: "message", content: "01: Priest - <@11111>", embeds: [] }];
  }),
});

describe("signup export migration", () => {
  it("defaults to the bot working directory rather than the deployed script location", () => {
    const root = resolve("deployed-bot");
    expect(parseSignupExportMigrationOptions(["--dry-run"], root)).toEqual({
      root,
      directory: join(root, "private", "signup-exports"),
      dryRun: true,
    });
  });

  it("resolves an explicit bot root and relative history override without changing cwd", () => {
    const cwd = process.cwd();
    const root = resolve("deployed-bot");
    expect(
      parseSignupExportMigrationOptions([
        "--root",
        root,
        "--directory",
        "custom-exports",
        "--dry-run",
      ]),
    ).toEqual({ root, directory: join(root, "custom-exports"), dryRun: true });
    expect(process.cwd()).toBe(cwd);
  });

  it("honors an absolute history directory and does not enable dry-run by default", () => {
    const root = resolve("deployed-bot");
    const directory = resolve("separate-history");
    expect(
      parseSignupExportMigrationOptions(["--directory", directory], root),
    ).toEqual({ root, directory, dryRun: false });
  });

  it("dry-runs only eligible active pending forum threads without writing files", async () => {
    const directory = await createDirectory();
    const rest = createRest([
      thread("legacy"),
      thread("done", "Done"),
      thread("no-share", "\u23f3 no share"),
      thread("other-forum", "\u23f3 Run", "another-forum"),
      { ...thread("archived"), thread_metadata: { archived: true } },
    ]);
    const result = await migrateSignupExports(
      rest as never,
      ["guild", "unset", "guild"],
      { guild: "forum", ineligible: "other" },
      directory,
      true,
    );
    expect(result).toEqual([
      {
        guildId: "guild",
        path: join(directory, "guild.json"),
        added: 1,
        updated: 0,
      },
    ]);
    expect(rest.get.mock.calls.map(([route]) => route)).toEqual([
      Routes.channel("forum"),
      Routes.guildActiveThreads("guild"),
      Routes.channelMessages("legacy"),
    ]);
    expect(await readdir(directory)).toEqual([]);
  });

  it("preserves history, backfills missing contents, backs up originals, and is idempotent", async () => {
    const directory = await createDirectory();
    const path = join(directory, "guild.json");
    const original = {
      oldKey: { threadId: "old" },
      existing: { threadId: "existing", contents: ["preserve <@22222>"] },
      reserved: { threadId: null },
    };
    const source = JSON.stringify(original);
    await writeFile(path, source);
    const rest = createRest([
      thread("old"),
      thread("existing"),
      thread("legacy"),
    ]);
    await expect(
      migrateSignupExports(
        rest as never,
        ["guild"],
        { guild: "forum" },
        directory,
      ),
    ).resolves.toEqual([{ guildId: "guild", path, added: 1, updated: 1 }]);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      ...original,
      oldKey: { threadId: "old", contents: ["01: Priest - <@11111>"] },
      '["legacy-thread","legacy"]': {
        threadId: "legacy",
        contents: ["01: Priest - <@11111>"],
      },
    });
    expect(await readFile(`${path}.migration.bak`, "utf8")).toBe(source);
    const migrated = await readFile(path, "utf8");
    await expect(
      migrateSignupExports(
        rest as never,
        ["guild"],
        { guild: "forum" },
        directory,
      ),
    ).resolves.toEqual([]);
    expect(await readFile(path, "utf8")).toBe(migrated);
    expect(await readFile(`${path}.migration.bak`, "utf8")).toBe(source);
  });

  it("reads every message page and includes embedded legacy rosters", async () => {
    const directory = await createDirectory();
    const rest = createRest();
    rest.get
      .mockResolvedValueOnce({
        type: ChannelType.GuildForum,
        guild_id: "guild",
      })
      .mockResolvedValueOnce({ threads: [thread("legacy")] })
      .mockResolvedValueOnce(
        Array.from({ length: 100 }, (_, index) => ({
          id: `message-${index}`,
          content: "text",
        })),
      )
      .mockResolvedValueOnce([
        {
          id: "oldest",
          content: "",
          embeds: [
            {
              description: "<@11111>",
              fields: [{ name: "Party", value: "<@22222>" }],
            },
          ],
        },
      ]);
    await migrateSignupExports(
      rest as never,
      ["guild"],
      { guild: "forum" },
      directory,
    );
    const history = JSON.parse(
      await readFile(join(directory, "guild.json"), "utf8"),
    );
    expect(history['["legacy-thread","legacy"]'].contents).toHaveLength(101);
    expect(history['["legacy-thread","legacy"]'].contents.at(-1)).toBe(
      "<@11111>\nParty\n<@22222>",
    );
    const options = rest.get.mock.calls[3]![1] as { query: URLSearchParams };
    expect(options.query.get("before")).toBe("message-99");
  });

  it("does not write any guild when scanning a later guild fails", async () => {
    const directory = await createDirectory();
    const rest = createRest();
    rest.get.mockImplementation(async (route) => {
      if (route === Routes.channel("second-forum"))
        throw new Error("Missing Access");
      if (route === Routes.channel("forum"))
        return { type: ChannelType.GuildForum, guild_id: "guild" };
      if (route === Routes.guildActiveThreads("guild"))
        return { threads: [thread("legacy")] };
      return [{ id: "message", content: "<@11111>" }];
    });
    await expect(
      migrateSignupExports(
        rest as never,
        ["guild", "second"],
        { guild: "forum", second: "second-forum" },
        directory,
      ),
    ).rejects.toThrow("Missing Access");
    expect(await readdir(directory)).toEqual([]);
  });

  it("rejects empty message contents instead of silently writing unusable history", async () => {
    const directory = await createDirectory();
    const rest = createRest();
    rest.get
      .mockResolvedValueOnce({
        type: ChannelType.GuildForum,
        guild_id: "guild",
      })
      .mockResolvedValueOnce({ threads: [thread("legacy")] })
      .mockResolvedValueOnce([{ id: "message", content: "", embeds: [] }]);
    await expect(
      migrateSignupExports(
        rest as never,
        ["guild"],
        { guild: "forum" },
        directory,
      ),
    ).rejects.toThrow("No readable message contents");
    expect(await readdir(directory)).toEqual([]);
  });
});
