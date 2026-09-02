import { jest } from "@jest/globals";
import type { Guild } from "discord.js";
import {
  getDisplayNameByDiscordTag,
  resolvePayoutDisplayName,
} from "./guild-members.js";

describe("guild member utilities", () => {
  it("maps guild member display names by normalized Discord tag", async () => {
    const members = [
      { user: { tag: "Alice" }, displayName: "Alice The Brave" },
      { user: { tag: "@Bob" }, displayName: "Bob The Wise" },
    ];
    const fetch = jest.fn().mockResolvedValue({
      map: <T>(callback: (member: (typeof members)[number]) => T): T[] =>
        members.map(callback),
    });
    const guild = { members: { fetch } } as unknown as Guild;

    await expect(getDisplayNameByDiscordTag(guild)).resolves.toEqual(
      new Map([
        ["alice", "Alice The Brave"],
        ["bob", "Bob The Wise"],
      ]),
    );
  });

  it("returns a guild display name or a Discord tag fallback", () => {
    const displayNames = new Map([["alice", "Alice The Brave"]]);

    expect(resolvePayoutDisplayName("@Alice", displayNames)).toBe(
      "Alice The Brave",
    );
    expect(resolvePayoutDisplayName("@Missing", displayNames)).toBe("Missing");
  });
});
