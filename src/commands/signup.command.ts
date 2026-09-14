import {
  ApplicationIntegrationType,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { SIGNUP_GUILD_IDS } from "../config/discord-settings.js";
import { COOLDOWN_INSTANCE_TYPES } from "../constants/cooldowns.js";
import { INSTANCE_TYPE_NONE_VALUE } from "../constants/signup.js";
import {
  executeAdd,
  executeCharNote,
  executeRemove,
  executeRemoveCharNote,
  executeRemoveTbc,
  executeSwap,
  executeTbc,
  executeWhen,
  getSheet,
  publish,
  replyMissing,
  signupSheetKey,
  update,
} from "../services/signup-actions.service.js";
import {
  buildRosterPromptButtons,
  pendingNoteUsers,
  pendingRosterUsers,
  pendingSetupDrafts,
  pendingSetupSnapshots,
  showSetup,
} from "../services/signup-setup.service.js";
import type { Command } from "../types/command.js";
import {
  getInvokingUserSlot,
  getRosterPrompt,
  isUserInRosterOrOrganizer,
  parseNewRunTimestamp,
  parseServerTimezone,
  parseTimeShift,
} from "../utils/signup-sheet.js";

// Re-export constants, action handlers, setup handlers, and button handlers
export * from "../constants/signup.js";
export * from "../services/signup-actions.service.js";
export * from "../services/signup-setup.service.js";
export * from "./signup-buttons.js";

const restrictToGuild = (command: Command): Command => ({
  ...command,
  guildIds: SIGNUP_GUILD_IDS,
  data: command.data
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
    .setContexts(InteractionContextType.Guild),
  execute: async (interaction) => {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "Signup sheets can only be used in a server text channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await command.execute(interaction);
  },
});

const setupCommand = (name: "newrun", description: string): Command => ({
  data: new SlashCommandBuilder().setName(name).setDescription(description),
  execute: async (interaction) => {
    const existingSheet = await getSheet(interaction);
    if (existingSheet) {
      await interaction.reply({
        content:
          "A signup sheet already exists in this text channel. Use `/change all` to update it.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await showSetup(interaction);
  },
});
const positionOption = (builder: SlashCommandBuilder): SlashCommandBuilder =>
  builder.addStringOption((option) =>
    option
      .setName("position")
      .setDescription(
        "Slot number(s) comma-separated, or reserve (blank removes all your signups)",
      )
      .setRequired(false),
  ) as unknown as SlashCommandBuilder;

const signupCommandDefinitions: Command[] = [
  setupCommand("newrun", "Create a signup sheet in this channel"),
  {
    data: new SlashCommandBuilder()
      .setName("change")
      .setDescription("Change a role or the complete party setup")
      .addSubcommand((subcommand) =>
        subcommand
          .setName("position")
          .setDescription("Change a slot role without removing its signup")
          .addStringOption((option) =>
            option
              .setName("value")
              .setDescription("New role")
              .setRequired(true),
          )
          .addIntegerOption((option) =>
            option
              .setName("position")
              .setDescription("Slot number")
              .setRequired(false),
          ),
      )
      .addSubcommand((subcommand) =>
        subcommand
          .setName("all")
          .setDescription("Change the complete party setup"),
      )
      .addSubcommand((subcommand) =>
        subcommand.setName("roster").setDescription("Change only the roster"),
      ) as unknown as SlashCommandBuilder,
    execute: async (interaction) => {
      const sheet = await getSheet(interaction);
      if (!sheet) {
        await replyMissing(interaction);
        return;
      }
      if (!isUserInRosterOrOrganizer(sheet, interaction.user)) {
        await interaction.reply({
          content:
            "Only the organizer or players on the roster can change the signup sheet.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "all") {
        await showSetup(interaction, sheet);
        return;
      }
      if (subcommand === "roster") {
        const key = signupSheetKey(
          interaction.guildId!,
          interaction.channelId!,
        );
        pendingSetupSnapshots.set(key, structuredClone(sheet));
        pendingSetupDrafts.set(key, sheet);
        pendingRosterUsers.set(key, interaction.user.id);
        await interaction.reply({
          content: getRosterPrompt(sheet.slots),
          components: [buildRosterPromptButtons()],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const position = interaction.options.getInteger("position");
      const slot = position
        ? sheet.slots.find((candidate) => candidate.number === position)
        : getInvokingUserSlot(sheet, interaction.user.id);
      if (!slot) {
        await interaction.reply({
          content: "That slot does not exist.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await update(interaction, (s) => {
        const targetSlot = position
          ? s.slots.find((candidate) => candidate.number === position)
          : getInvokingUserSlot(s, interaction.user.id);
        if (!targetSlot) return "That slot does not exist.";
        targetSlot.role = interaction.options.getString("value", true);
        return null;
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("name")
      .setDescription("Set the run title")
      .addStringOption((o) =>
        o.setName("input").setDescription("Run name").setRequired(true),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await update(i, (s) => {
        s.title = i.options.getString("input", true);
        return null;
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("note")
      .setDescription("Edit important notes"),
    execute: async (i) => {
      const sheet = await getSheet(i);
      if (!sheet) {
        await replyMissing(i);
        return;
      }
      pendingNoteUsers.set(signupSheetKey(i.guildId!, i.channelId!), i.user.id);
      await i.reply({
        content: `Current notes:\n\`\`\`\n${sheet.notes?.trim() || "None"}\n\`\`\`\nSend your updated notes as your next message in this channel, or type \`remove\` to clear them.`,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("setpic")
      .setDescription("Set the sheet thumbnail")
      .addStringOption((o) =>
        o.setName("url").setDescription("Image URL").setRequired(true),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await update(i, (s) => {
        const url = i.options.getString("url", true);
        if (!/^https?:\/\//i.test(url)) return "Provide an http(s) image URL.";
        s.thumbnailUrl = url;
        return null;
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("color")
      .setDescription("Set the embed color")
      .addStringOption((o) =>
        o
          .setName("hexcodecolor")
          .setDescription("Hex color, e.g. #00b0f4")
          .setRequired(true),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await update(i, (s) => {
        const value = i.options
          .getString("hexcodecolor", true)
          .replace(/^#/, "");
        if (!/^[\da-f]{6}$/i.test(value))
          return "Provide a six-digit hex color, e.g. `#00b0f4`.";
        s.color = Number.parseInt(value, 16);
        return null;
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("setservertimezone")
      .setDescription("Set the server timezone")
      .addStringOption((o) =>
        o
          .setName("timezone")
          .setDescription("GMT, GMT+8, GMT-5, etc.")
          .setRequired(true),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await update(i, (s) => {
        const timezone = parseServerTimezone(
          i.options.getString("timezone", true),
        );
        if (timezone === undefined)
          return "Use a server timezone such as `GMT`, `GMT+8`, or `GMT-5`.";
        s.serverTimezone = timezone;
        return null;
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("setinstancetype")
      .setDescription("Set the instance type for this run")
      .addStringOption((o) =>
        o
          .setName("type")
          .setDescription("Instance type")
          .setRequired(true)
          .addChoices(
            { name: "None", value: INSTANCE_TYPE_NONE_VALUE },
            ...COOLDOWN_INSTANCE_TYPES.filter(
              (type) => type.name !== "Others",
            ).map((type) => ({ name: type.name, value: type.name })),
          ),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await update(i, (s) => {
        const type = i.options.getString("type", true);
        s.instanceType = type === INSTANCE_TYPE_NONE_VALUE ? null : type;
        return null;
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("add")
      .setDescription("Sign up for a slot or reserve")
      .addStringOption((option) =>
        option
          .setName("input")
          .setDescription(
            "Slot number(s), `random`, or `reserve`, optionally followed by @user",
          )
          .setRequired(true),
      ) as SlashCommandBuilder,
    execute: async (interaction) => {
      await executeAdd(
        interaction,
        interaction.options.getString("input", true),
      );
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("a")
      .setDescription("Alias for add")
      .addStringOption((option) =>
        option
          .setName("input")
          .setDescription(
            "Slot number(s), `random`, or `reserve`, optionally followed by @user",
          )
          .setRequired(true),
      ) as SlashCommandBuilder,
    execute: (i) =>
      signupCommands.find((c) => c.data.name === "add")!.execute(i),
  },
  {
    data: positionOption(
      new SlashCommandBuilder()
        .setName("remove")
        .setDescription("Remove a signup or reserve"),
    ),
    execute: async (i) => {
      await executeRemove(i, i.options.getString("position"));
    },
  },
  {
    data: positionOption(
      new SlashCommandBuilder().setName("r").setDescription("Alias for remove"),
    ),
    execute: (i) =>
      signupCommands.find((c) => c.data.name === "remove")!.execute(i),
  },
  {
    data: new SlashCommandBuilder()
      .setName("clear")
      .setDescription("Clear the roster, schedule, or both")
      .addStringOption((o) =>
        o
          .setName("which")
          .setDescription("What to clear")
          .setRequired(true)
          .addChoices(
            { name: "Roster", value: "roster" },
            { name: "Schedule", value: "schedule" },
            { name: "All", value: "all" },
          ),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await update(i, (s) => {
        const which = i.options.getString("which", true);
        if (which === "roster" || which === "all") {
          for (const slot of s.slots) {
            slot.signupUserId = null;
            slot.signupDisplayName = null;
            slot.charNote = null;
            slot.isTbc = false;
          }
          s.reserves = [];
        }
        if (which === "schedule" || which === "all") {
          s.timestamp = null;
          s.scheduleTimezone = null;
        }
        return null;
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("c")
      .setDescription("Alias for clear")
      .addStringOption((o) =>
        o
          .setName("which")
          .setDescription("What to clear")
          .setRequired(true)
          .addChoices(
            { name: "Roster", value: "roster" },
            { name: "Schedule", value: "schedule" },
            { name: "All", value: "all" },
          ),
      ) as SlashCommandBuilder,
    execute: (i) =>
      signupCommands.find((c) => c.data.name === "clear")!.execute(i),
  },
  {
    data: new SlashCommandBuilder()
      .setName("swap")
      .setDescription("Join a slot or swap two slots")
      .addStringOption((o) =>
        o
          .setName("first")
          .setDescription("Your or first slot number, or reserve")
          .setRequired(true),
      )
      .addStringOption((o) =>
        o.setName("second").setDescription("Second slot number or reserve"),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await executeSwap(
        i,
        i.options.getString("first", true),
        i.options.getString("second"),
      );
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("charnote")
      .setDescription("Set a character note")
      .addStringOption((o) =>
        o.setName("note").setDescription("Character note").setRequired(true),
      )
      .addIntegerOption((o) =>
        o.setName("position").setDescription("Slot").setRequired(false),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await executeCharNote(
        i,
        i.options.getString("note", true),
        i.options.getInteger("position"),
      );
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("char")
      .setDescription("Alias for charnote")
      .addStringOption((o) =>
        o.setName("note").setDescription("Character note").setRequired(true),
      )
      .addIntegerOption((o) =>
        o.setName("position").setDescription("Slot").setRequired(false),
      ) as SlashCommandBuilder,
    execute: (i) =>
      signupCommands.find((c) => c.data.name === "charnote")!.execute(i),
  },
  {
    data: new SlashCommandBuilder()
      .setName("removecharnote")
      .setDescription("Remove character notes")
      .addStringOption((o) =>
        o
          .setName("input")
          .setDescription(
            "Slot number(s) comma-separated (blank removes all your character notes)",
          )
          .setRequired(false),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await executeRemoveCharNote(i, i.options.getString("input"));
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("rc")
      .setDescription("Alias for removecharnote")
      .addStringOption((o) =>
        o
          .setName("input")
          .setDescription(
            "Slot number(s) comma-separated (blank removes all your character notes)",
          )
          .setRequired(false),
      ) as SlashCommandBuilder,
    execute: (i) =>
      signupCommands.find((c) => c.data.name === "removecharnote")!.execute(i),
  },
  {
    data: new SlashCommandBuilder()
      .setName("tbc")
      .setDescription("Mark slots or yourself as To Be Confirmed (TBC)")
      .addStringOption((o) =>
        o
          .setName("input")
          .setDescription(
            "Slot number(s) comma-separated (blank toggles your own TBC status)",
          )
          .setRequired(false),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await executeTbc(i, i.options.getString("input"));
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("removetbc")
      .setDescription("Remove TBC markings from slots or yourself")
      .addStringOption((o) =>
        o
          .setName("input")
          .setDescription(
            "Slot number(s) comma-separated (blank removes your own TBC status)",
          )
          .setRequired(false),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await executeRemoveTbc(i, i.options.getString("input"));
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("rtbc")
      .setDescription("Alias for removetbc")
      .addStringOption((o) =>
        o
          .setName("input")
          .setDescription(
            "Slot number(s) comma-separated (blank removes your own TBC status)",
          )
          .setRequired(false),
      ) as SlashCommandBuilder,
    execute: (i) =>
      signupCommands.find((c) => c.data.name === "removetbc")!.execute(i),
  },
  ...["postpone", "next"].map((name) => ({
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(`${name} the run`)
      .addStringOption((o) =>
        o
          .setName("value")
          .setDescription("For example: next week, last hour, or 1.5 days")
          .setRequired(true),
      ) as SlashCommandBuilder,
    execute: async (i: ChatInputCommandInteraction) => {
      await update(i, (s) => {
        const delta = parseTimeShift(i.options.getString("value", true));
        if (delta === null)
          return "Use `next`, `last`, or a number in 0.5 increments followed by minutes, hours, days, weeks, or months.";
        if (s.timestamp === null)
          return "The schedule is TBD. Set a date first with `/sdt`.";
        s.timestamp += delta;
        if (name === "next")
          for (const slot of s.slots) {
            slot.signupUserId = null;
            slot.signupDisplayName = null;
            slot.charNote = null;
            slot.isTbc = false;
          }
        return null;
      });
    },
  })),
  {
    data: new SlashCommandBuilder()
      .setName("gonow")
      .setDescription("Set the run to now, optionally offset by a duration")
      .addStringOption((o) =>
        o
          .setName("value")
          .setDescription("For example: next week, last hour, or 1.5 days"),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await update(i, (s) => {
        const value = i.options.getString("value");
        const delta = value ? parseTimeShift(value) : 0;
        if (delta === null)
          return "Use `next`, `last`, or a number in 0.5 increments followed by minutes, hours, days, weeks, or months.";
        s.timestamp = Math.floor(Date.now() / 1000) + delta;
        return null;
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("sdt")
      .setDescription("Set date and time")
      .addStringOption((o) =>
        o
          .setName("datetime")
          .setDescription("Date/time, e.g. 10/09 20:00 GMT+8, or TBD")
          .setRequired(true),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await update(i, (s) => {
        const datetimeValue = i.options.getString("datetime", true).trim();
        if (/^tbd$/i.test(datetimeValue)) {
          s.timestamp = null;
          s.scheduleTimezone = null;
          return null;
        }
        const schedule = parseNewRunTimestamp(datetimeValue);
        if (!schedule)
          return "Use date/time format `DD/MM HH:MM GMT+8`, or `TBD`.";
        s.timestamp = schedule.timestamp;
        s.scheduleTimezone = schedule.scheduleTimezone;
        return null;
      });
    },
  },
  ...["last", "s", "show"].map((name) => ({
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(
        "Show this channel's signup sheet",
      ) as SlashCommandBuilder,
    execute: async (interaction: ChatInputCommandInteraction) => {
      await interaction.deferReply();
      await update(interaction, () => null);
    },
  })),

  {
    data: new SlashCommandBuilder()
      .setName("when")
      .setDescription("Show the run time"),
    execute: async (i) => {
      await executeWhen(i);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Ping signed-up players")
      .addStringOption((o) =>
        o.setName("message").setDescription("Message").setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName("which")
          .setDescription("Who to ping")
          .setRequired(true)
          .addChoices(
            { name: "Main Roster", value: "main" },
            { name: "Reserves", value: "reserves" },
            { name: "TBC", value: "tbc" },
            { name: "All", value: "all" },
          ),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      const s = await getSheet(i);
      if (!s) {
        await replyMissing(i);
        return;
      }
      const which = i.options.getString("which", true);
      const mainIds = s.slots.flatMap((slot) =>
        slot.signupUserId ? [slot.signupUserId] : [],
      );
      const reserveIds = s.reserves.map((reserve) => reserve.userId);
      const tbcIds = [
        ...s.slots.flatMap((slot) =>
          slot.signupUserId && slot.isTbc ? [slot.signupUserId] : [],
        ),
        ...s.reserves.flatMap((reserve) =>
          reserve.isTbc ? [reserve.userId] : [],
        ),
      ];
      const ids = [
        ...(which === "main" || which === "all" ? mainIds : []),
        ...(which === "reserves" || which === "all" ? reserveIds : []),
        ...(which === "tbc" ? tbcIds : []),
      ];
      await i.reply({
        content:
          `Ping from **${i.user.displayName}**: ${i.options.getString("message", true)}\n\n${ids.map((id) => `<@${id}>`).join(" ")}`.trim(),
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("swaporganizer")
      .setDescription("Change the organizer")
      .addUserOption((o) =>
        o.setName("user").setDescription("New organizer").setRequired(true),
      ) as SlashCommandBuilder,
    execute: async (i) => {
      await update(i, (s) => {
        const user = i.options.getUser("user", true);
        s.organizerId = user.id;
        s.organizerName = user.displayName;
        s.organizerAvatarUrl = user.displayAvatarURL({
          extension: "png",
          size: 512,
        });
        return null;
      });
    },
  },
];

export const signupCommands: Command[] =
  signupCommandDefinitions.map(restrictToGuild);
