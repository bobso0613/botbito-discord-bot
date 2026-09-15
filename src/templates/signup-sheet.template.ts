import { EmbedBuilder } from "discord.js";
import { DISCORD_SETTINGS } from "../config/discord-settings.js";
import { COOLDOWN_INSTANCE_TYPES } from "../constants/cooldowns.js";
import type { InstanceType } from "../constants/cooldowns.js";
import type { SignupSheet } from "../types/signup-sheet.js";

/** Returns the hour offset from GMT for a normalized timezone string (e.g. `GMT+8`). */
const getServerTimezoneOffset = (timezone: string): number =>
  timezone === "GMT" ? 0 : Number(timezone.slice(3));

/** Formats a sheet's instance type as `<emoji> <name>`, or `null` when unset. */
const formatInstanceType = (
  instanceType: string | null,
  instanceTypes: readonly InstanceType[],
): string | null => {
  if (!instanceType) return null;
  const type = instanceTypes.find((t) => t.name === instanceType);
  return `${type?.emoji ?? ""} ${instanceType}`.trim();
};

/**
 * Formats a sheet's schedule for the embed's Schedule field: the invoker's
 * local time (or `TBD`), plus the server date/time/timezone when a
 * `serverTimezone` is configured (also `TBD` while the schedule is unset).
 */
export const formatSignupSchedule = (sheet: SignupSheet): string => {
  if (sheet.timestamp === null) {
    const yourTime = "*Your Time: TBD*";
    return sheet.serverTimezone
      ? `${yourTime}\n\nServer Date: TBD\nServer Time: TBD\nServer Timezone: ${sheet.serverTimezone}`
      : yourTime;
  }
  const yourTime = `*Your Time: <t:${sheet.timestamp}:F>*\n*<t:${sheet.timestamp}:R>*`;
  if (!sheet.serverTimezone) return yourTime;
  const serverDate = new Date(
    (sheet.timestamp + getServerTimezoneOffset(sheet.serverTimezone) * 3600) *
      1000,
  );
  const serverDateText = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(serverDate);
  const hours = serverDate.getUTCHours();
  const serverTime = `${String(hours % 12 || 12).padStart(2, "0")}:${String(
    serverDate.getUTCMinutes(),
  ).padStart(2, "0")} ${hours >= 12 ? "pm" : "am"}`;
  return `${yourTime}\n\nServer Date: ${serverDateText}\nServer Time: ${serverTime}\nServer Timezone: ${sheet.serverTimezone}`;
};

/** Full signup command reference shown by the "Show list of commands" button and `/help`. */
export const SIGNUP_COMMANDS_HELP_TEXT = [
  "**Manage Self:** `/add input=#/random/reserve`, `/remove`, `/remove input=#`, `/swap first=#/random/reserve second=#`, `/charnote input=YourNote`, `/removecharnote`, `/tbc`, `/removetbc`",
  "",
  "**Manage others:** `/add input=#/random/reserve @user`, `/remove input='# of @user'`, `/swap first='# of @user' second=#`",
  "",
  "**Manage Sheet:** `/swaporganizer`, `/newrun`, `/name`, `/note`, `/color`, `/setpic`, `/setservertimezone`, `/change position`, `/change all`, `/change roster`, `/clear`, `/setinstancetype`",
  "",
  "**Schedule Commands:** `/when`, `/sdt`, `/gonow`, `/next week`, `/postpone`",
  "",
  "Use: `/last` or `/show`",
].join("\n");

/** Formats a single party slot as `NN: Role -` optionally followed by the signed-up member and character note. */
const formatSlot = (slot: SignupSheet["slots"][number]): string => {
  const signedUp = slot.signupDisplayName
    ? ` **${slot.signupDisplayName}**${slot.charNote ? ` *(${slot.charNote})*` : ""}${slot.isTbc ? " ❓" : ""}`
    : `${slot.isTbc ? " ❓" : ""}`;
  return `\`${String(slot.number).padStart(2, "0")}\`: ${slot.role} -${signedUp}`;
};

/**
 * Builds the full signup sheet embed: notes, one field per party with its
 * slots, the reserve list, fill and TBC counts as inline fields, the schedule,
 * and an organizer footer that includes the instance type (with emoji) when one is set.
 */
export const buildSignupSheetEmbed = (
  sheet: SignupSheet,
  guildName: string,
  guildIconUrl: string | null,
): EmbedBuilder => {
  const instanceTypes =
    DISCORD_SETTINGS.cooldownInstanceTypesByGuild[sheet.guildId] ??
    COOLDOWN_INSTANCE_TYPES;
  const signedUpCount = sheet.slots.filter(
    (slot) => slot.signupDisplayName,
  ).length;
  const tbcCount =
    sheet.slots.filter((slot) => slot.isTbc).length +
    sheet.reserves.filter((reserve) => reserve.isTbc).length;
  let slotOffset = 0;
  const partyFields = sheet.partySizes.map((partySize, index) => {
    const slots = sheet.slots.slice(slotOffset, slotOffset + partySize);
    slotOffset += partySize;
    return {
      name: `__Party ${index + 1}:__`,
      value: slots.map(formatSlot).join("\n") || "Empty",
      inline: false,
    };
  });
  const reserveText = sheet.reserves.length
    ? sheet.reserves
        .map(
          (reserve, index) =>
            `\`${String(sheet.slots.length + index + 1).padStart(2, "0")}\`: **${reserve.displayName}**${reserve.charNote ? ` *(${reserve.charNote})*` : ""}${reserve.isTbc ? " ❓" : ""}`,
        )
        .join("\n")
    : "None - *to add as reserve, type `/add input=reserve`*";
  const embed = new EmbedBuilder()
    .setAuthor({
      name: guildName,
      ...(guildIconUrl ? { iconURL: guildIconUrl } : {}),
    })
    .setTitle(sheet.title)
    .addFields(
      ...partyFields,
      { name: "Reserves:", value: reserveText, inline: false },
      {
        name: "",
        value: `🗓️ **${signedUpCount}** of **${sheet.slots.length}** filled`,
        inline: true,
      },
      {
        name: "",
        value: `🪑 **${sheet.reserves.length}** reserve/s`,
        inline: true,
      },
      {
        name: "",
        value: `❓ **${tbcCount}** TBC`,
        inline: true,
      },
      {
        name: "Schedule:",
        value: formatSignupSchedule(sheet),
        inline: false,
      },
    )
    .setFooter({
      text: [
        `Organizer - ${sheet.organizerName}`,
        formatInstanceType(sheet.instanceType, instanceTypes),
      ]
        .filter((section): section is string => Boolean(section))
        .join(" | "),
      iconURL: sheet.organizerAvatarUrl,
    });
  if (sheet.notes?.trim()) {
    embed.setDescription(`Important Notes:\n${sheet.notes.trim()}`);
  }
  if (sheet.thumbnailUrl) embed.setThumbnail(sheet.thumbnailUrl);
  if (sheet.color !== null) embed.setColor(sheet.color);
  return embed;
};
