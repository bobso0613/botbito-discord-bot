import "dotenv/config";
import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  MessageFlags,
  Partials,
  REST,
  Routes,
  ActivityType,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from "discord.js";
import { commands } from "./commands/index.js";
import { sendHelp, handleHelpAutocomplete } from "./commands/help.command.js";
import { sendMyCooldowns } from "./commands/mycooldowns.command.js";
import { sendMySchedule } from "./commands/mysched.command.js";
import { sendPayout } from "./commands/payout.command.js";
import {
  handleSignupModal,
  handleSignupRosterButton,
  handleSignupNoRosterChangesButton,
  handleSignupRosterMessage,
  handleSignupCancelSetupButton,
  handleSignupAddConfirmButton,
  handleSignupAddCancelButton,
  handleSignupInfoButton,
  handleSignupInstanceTypeButton,
  handleSignupInstanceTypeSelect,
  handleSignupEditPartySetupButton,
} from "./commands/signup.command.js";
import { registerGuildScheduleAnnouncementListener } from "./services/guild-schedule-announcement.service.js";
import {
  HELP_BUTTON_ID,
  MY_COOLDOWNS_BUTTON_ID,
  MY_PAYOUT_STATUS_BUTTON_ID,
  MY_SCHEDULE_BUTTON_ID,
} from "./templates/guild-schedule.template.js";
import {
  SIGNUP_ROSTER_BUTTON_ID,
  SIGNUP_NO_ROSTER_CHANGES_BUTTON_ID,
  SIGNUP_CANCEL_SETUP_BUTTON_ID,
  SIGNUP_ADD_CONFIRM_BUTTON_ID,
  SIGNUP_ADD_CANCEL_BUTTON_ID,
  SIGNUP_INFO_BUTTON_ID,
  SIGNUP_INSTANCE_TYPE_BUTTON_ID,
  SIGNUP_INSTANCE_TYPE_SELECT_ID,
  SIGNUP_EDIT_PARTY_SETUP_BUTTON_ID,
} from "./commands/signup.command.js";
import { logger } from "./utils/logger.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token) {
  throw new Error("DISCORD_TOKEN must be set");
}

const botToken = token;
logger.log("Bot process started.");

const isDevelopmentEnvironment = process.env.MODE?.toUpperCase() === "DEV";
const shouldRegisterGuildScheduleAnnouncementListener =
  !isDevelopmentEnvironment ||
  process.env.ENABLE_GUILD_SCHEDULE_ANNOUNCEMENTS === "true";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  // Uncached schedule messages need to be partial, or Discord.js drops their edit events entirely.
  partials: [Partials.Message, Partials.Channel],
});
if (shouldRegisterGuildScheduleAnnouncementListener) {
  registerGuildScheduleAnnouncementListener(client);
} else {
  logger.log("Guild schedule announcement listener is disabled in DEV mode.");
}
const commandsByName = new Collection(
  commands.map((command) => [command.data.name, command]),
);

const getCommandLogContext = (
  interaction: ChatInputCommandInteraction | ButtonInteraction,
): string => {
  return [
    `guildName=${JSON.stringify(interaction.guild?.name ?? "direct-message")}`,
    `username=${JSON.stringify(interaction.user.username)}`,
    `parameters=${JSON.stringify(
      interaction.isChatInputCommand() ? interaction.options.data : [],
    )}`,
  ].join(" ");
};

const registerGuildSlashCommands = async (guildId: string): Promise<void> => {
  if (!clientId) {
    logger.warn(
      "DISCORD_CLIENT_ID is not set; skipping slash command registration.",
    );
    return;
  }

  const commandBody = commands
    .filter((command) => command.guildIds?.includes(guildId))
    .map((command) => command.data.toJSON());
  const rest = new REST().setToken(botToken);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commandBody,
  });
  logger.log(
    `Registered ${commandBody.length} slash command(s) for guild ${guildId}.`,
  );
};

client.once(Events.ClientReady, async (readyClient) => {
  readyClient.user.setPresence({
    activities: [
      {
        name: "/help /payout /guildsched | @bobito",
        type: ActivityType.Listening,
      },
    ],
  });

  for (const guildId of readyClient.guilds.cache.keys()) {
    await registerGuildSlashCommands(guildId);
  }
  logger.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.GuildCreate, async (guild) => {
  await registerGuildSlashCommands(guild.id);
});

client.on(Events.MessageCreate, async (message) => {
  try {
    await handleSignupRosterMessage(message);
  } catch (error) {
    logger.error("Signup roster message processing failed:", error);
  }
});

/**
 * Handles slash commands and primary action buttons on guild schedule output.
 * Button logs include `button`, `buttonLabel`, status, and the standard guild,
 * user, and parameter context; button interactions have an empty parameter list.
 */
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isModalSubmit()) {
    try {
      await handleSignupModal(interaction as ModalSubmitInteraction);
    } catch (error) {
      logger.error("Signup modal processing failed:", error);
      if (interaction.deferred || interaction.replied)
        await interaction.editReply(
          "Something went wrong while processing this signup sheet.",
        );
      else
        await interaction.reply({
          content: "Something went wrong while processing this signup sheet.",
          flags: MessageFlags.Ephemeral,
        });
    }
    return;
  }
  if (interaction.isButton()) {
    const buttonActions: Readonly<
      Record<string, (buttonInteraction: ButtonInteraction) => Promise<void>>
    > = {
      [MY_SCHEDULE_BUTTON_ID]: (buttonInteraction) =>
        sendMySchedule(buttonInteraction),
      [MY_PAYOUT_STATUS_BUTTON_ID]: (buttonInteraction) =>
        sendPayout(buttonInteraction, true),
      [MY_COOLDOWNS_BUTTON_ID]: (buttonInteraction) =>
        sendMyCooldowns(buttonInteraction),
      [HELP_BUTTON_ID]: (buttonInteraction) => sendHelp(buttonInteraction),
      [SIGNUP_ROSTER_BUTTON_ID]: (buttonInteraction) =>
        handleSignupRosterButton(buttonInteraction),
      [SIGNUP_NO_ROSTER_CHANGES_BUTTON_ID]: (buttonInteraction) =>
        handleSignupNoRosterChangesButton(buttonInteraction),
      [SIGNUP_CANCEL_SETUP_BUTTON_ID]: (buttonInteraction) =>
        handleSignupCancelSetupButton(buttonInteraction),
      [SIGNUP_ADD_CONFIRM_BUTTON_ID]: (buttonInteraction) =>
        handleSignupAddConfirmButton(buttonInteraction),
      [SIGNUP_ADD_CANCEL_BUTTON_ID]: (buttonInteraction) =>
        handleSignupAddCancelButton(buttonInteraction),
      [SIGNUP_INFO_BUTTON_ID]: (buttonInteraction) =>
        handleSignupInfoButton(buttonInteraction),
      [SIGNUP_INSTANCE_TYPE_BUTTON_ID]: (buttonInteraction) =>
        handleSignupInstanceTypeButton(buttonInteraction),
      [SIGNUP_EDIT_PARTY_SETUP_BUTTON_ID]: (buttonInteraction) =>
        handleSignupEditPartySetupButton(buttonInteraction),
    };
    const buttonAction = buttonActions[interaction.customId];
    if (!buttonAction) return;
    const buttonLabel =
      "label" in interaction.component
        ? (interaction.component.label ?? null)
        : null;

    try {
      await buttonAction(interaction);
      logger.log(
        `button=${interaction.customId} buttonLabel=${JSON.stringify(buttonLabel)} status=success guildId=${interaction.guildId ?? "direct-message"} userId=${interaction.user.id} ${getCommandLogContext(interaction)}`,
      );
    } catch (error) {
      logger.error(
        `button=${interaction.customId} buttonLabel=${JSON.stringify(buttonLabel)} status=fail guildId=${interaction.guildId ?? "direct-message"} userId=${interaction.user.id} ${getCommandLogContext(interaction)}`,
        error,
      );
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(
            "Something went wrong while processing this command. Please try again.",
          );
        } else {
          await interaction.reply({
            content:
              "Something went wrong while processing this command. Please try again.",
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch (replyError) {
        logger.error("Failed to send button error response:", replyError);
      }
    }
    return;
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId !== SIGNUP_INSTANCE_TYPE_SELECT_ID) return;
    try {
      await handleSignupInstanceTypeSelect(
        interaction as StringSelectMenuInteraction,
      );
    } catch (error) {
      logger.error("Signup instance type select processing failed:", error);
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(
            "Something went wrong while processing this command. Please try again.",
          );
        } else {
          await interaction.reply({
            content:
              "Something went wrong while processing this command. Please try again.",
            flags: MessageFlags.Ephemeral,
          });
        }
      } catch (replyError) {
        logger.error("Failed to send select menu error response:", replyError);
      }
    }
    return;
  }

  if (interaction.isAutocomplete()) {
    if (interaction.commandName === "help") {
      try {
        await handleHelpAutocomplete(interaction);
      } catch (error) {
        logger.error("Help autocomplete failed:", error);
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = commandsByName.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
    logger.log(
      `command=/${interaction.commandName} status=success guildId=${interaction.guildId ?? "direct-message"} userId=${interaction.user.id} ${getCommandLogContext(interaction)}`,
    );
  } catch (error) {
    logger.error(
      `command=/${interaction.commandName} status=fail guildId=${interaction.guildId ?? "direct-message"} userId=${interaction.user.id} ${getCommandLogContext(interaction)}`,
      error,
    );

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(
          "Something went wrong while processing this command. Please try again.",
        );
      } else {
        await interaction.reply({
          content:
            "Something went wrong while processing this command. Please try again.",
          flags: MessageFlags.Ephemeral,
        });
      }
    } catch (replyError) {
      logger.error("Failed to send command error response:", replyError);
    }
  }
});

client.on(Events.Error, (error) => {
  logger.error("Discord client error:", error);
});

client.login(botToken);
