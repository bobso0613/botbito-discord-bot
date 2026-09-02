import type { Guild } from "discord.js";

const normalizeDiscordTag = (discordTag: string): string =>
  discordTag.trim().replace(/^@/, "").toLocaleLowerCase();

export const getDisplayNameByDiscordTag = async (
  guild: Guild,
): Promise<Map<string, string>> => {
  const members = await guild.members.fetch();

  return new Map(
    members.map((member) => [
      normalizeDiscordTag(member.user.tag),
      member.displayName,
    ]),
  );
};

export const resolvePayoutDisplayName = (
  discordTag: string,
  displayNameByDiscordTag: ReadonlyMap<string, string>,
): string =>
  displayNameByDiscordTag.get(normalizeDiscordTag(discordTag)) ??
  discordTag.replace(/^@/, "");
