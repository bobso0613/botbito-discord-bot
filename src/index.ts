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
  type AutocompleteInteraction,
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
  handleSetInstanceTypeAutocomplete,
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
  SIGNUP_ROSTER_BUTTON_ID,
  SIGNUP_NO_ROSTER_CHANGES_BUTTON_ID,
  SIGNUP_CANCEL_SETUP_BUTTON_ID,
  SIGNUP_ADD_CONFIRM_BUTTON_ID,
  SIGNUP_ADD_CANCEL_BUTTON_ID,
  SIGNUP_INFO_BUTTON_ID,
  SIGNUP_INSTANCE_TYPE_BUTTON_ID,
  SIGNUP_INSTANCE_TYPE_SELECT_ID,
  SIGNUP_EDIT_PARTY_SETUP_BUTTON_ID,
  SIGNUP_ADD_BUTTON_ID,
  SIGNUP_REMOVE_BUTTON_ID,
  SIGNUP_TBC_BUTTON_ID,
  SIGNUP_CHARNOTE_BUTTON_ID,
  SIGNUP_REMOVE_CHARNOTE_BUTTON_ID,
  SIGNUP_SWAP_BUTTON_ID,
  SIGNUP_WHEN_BUTTON_ID,
  handleSignupAddButton,
  handleSignupRemoveButton,
  handleSignupTbcButton,
  handleSignupCharNoteButton,
  handleSignupRemoveCharNoteButton,
  handleSignupSwapButton,
  handleSignupWhenButton,
} from "./commands/signup.command.js";
import { registerGuildScheduleAnnouncementListener } from "./services/guild-schedule-announcement.service.js";
import { ensureGuildSettings } from "./services/guild-settings.service.js";
import {
  HELP_BUTTON_ID,
  MY_COOLDOWNS_BUTTON_ID,
  MY_PAYOUT_STATUS_BUTTON_ID,
  MY_SCHEDULE_BUTTON_ID,
} from "./templates/guild-schedule.template.js";
import { DISCORD_SETTINGS } from "./config/discord-settings.js";
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
    .filter(
      (command) =>
        command.guildIds?.includes(guildId) ||
        command.registerInAllGuilds ||
        (command.requiresGuildScheduleSettings &&
          guildId in DISCORD_SETTINGS.guildScheduleSourceByGuild),
    )
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
        name: "Use /help for command list | @bobito",
        type: ActivityType.Listening,
      },
    ],
  });

  for (const guildId of readyClient.guilds.cache.keys()) {
    try {
      await ensureGuildSettings(guildId);
    } catch (error) {
      logger.error(
        `Failed to initialize settings for guild ${guildId}:`,
        error,
      );
    }
    await registerGuildSlashCommands(guildId);
  }
  logger.log(
    `Loaded ${Object.keys(DISCORD_SETTINGS.guildScheduleSourceByGuild).length} guild setting file(s) for ${readyClient.guilds.cache.size} joined guild(s).`,
  );
  logger.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.GuildCreate, async (guild) => {
  try {
    await ensureGuildSettings(guild.id);
    await registerGuildSlashCommands(guild.id);
  } catch (error) {
    logger.error(`Failed to initialize settings for guild ${guild.id}:`, error);
  }
});

client.on(Events.MessageCreate, async (message) => {
  try {
    await handleSignupRosterMessage(message);
  } catch (error) {
    logger.error("Signup roster message processing failed:", error);
  }
});

/** Replies with a failure message, editing the deferred/replied response if one already exists. */
const replyWithFailureMessage = async (
  interaction:
    | ButtonInteraction
    | ModalSubmitInteraction
    | StringSelectMenuInteraction
    | ChatInputCommandInteraction,
  message: string,
): Promise<void> => {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply(message);
  } else {
    await interaction.reply({
      content: message,
      flags: MessageFlags.Ephemeral,
    });
  }
};

const handleModalSubmitInteraction = async (
  interaction: ModalSubmitInteraction,
): Promise<void> => {
  try {
    await handleSignupModal(interaction);
  } catch (error) {
    logger.error("Signup modal processing failed:", error);
    await replyWithFailureMessage(
      interaction,
      "Something went wrong while processing this signup sheet.",
    );
  }
};

const BUTTON_ACTIONS: Readonly<
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
  [SIGNUP_ADD_BUTTON_ID]: (buttonInteraction) =>
    handleSignupAddButton(buttonInteraction),
  [SIGNUP_REMOVE_BUTTON_ID]: (buttonInteraction) =>
    handleSignupRemoveButton(buttonInteraction),
  [SIGNUP_TBC_BUTTON_ID]: (buttonInteraction) =>
    handleSignupTbcButton(buttonInteraction),
  [SIGNUP_CHARNOTE_BUTTON_ID]: (buttonInteraction) =>
    handleSignupCharNoteButton(buttonInteraction),
  [SIGNUP_REMOVE_CHARNOTE_BUTTON_ID]: (buttonInteraction) =>
    handleSignupRemoveCharNoteButton(buttonInteraction),
  [SIGNUP_SWAP_BUTTON_ID]: (buttonInteraction) =>
    handleSignupSwapButton(buttonInteraction),
  [SIGNUP_WHEN_BUTTON_ID]: (buttonInteraction) =>
    handleSignupWhenButton(buttonInteraction),
  [SIGNUP_INSTANCE_TYPE_BUTTON_ID]: (buttonInteraction) =>
    handleSignupInstanceTypeButton(buttonInteraction),
  [SIGNUP_EDIT_PARTY_SETUP_BUTTON_ID]: (buttonInteraction) =>
    handleSignupEditPartySetupButton(buttonInteraction),
};

const handleButtonInteraction = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  const buttonAction = BUTTON_ACTIONS[interaction.customId];
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
      await replyWithFailureMessage(
        interaction,
        "Something went wrong while processing this command. Please try again.",
      );
    } catch (replyError) {
      logger.error("Failed to send button error response:", replyError);
    }
  }
};

const handleSelectMenuInteraction = async (
  interaction: StringSelectMenuInteraction,
): Promise<void> => {
  if (interaction.customId !== SIGNUP_INSTANCE_TYPE_SELECT_ID) return;
  try {
    await handleSignupInstanceTypeSelect(interaction);
  } catch (error) {
    logger.error("Signup instance type select processing failed:", error);
    try {
      await replyWithFailureMessage(
        interaction,
        "Something went wrong while processing this command. Please try again.",
      );
    } catch (replyError) {
      logger.error("Failed to send select menu error response:", replyError);
    }
  }
};

const handleAutocompleteInteraction = async (
  interaction: AutocompleteInteraction,
): Promise<void> => {
  if (interaction.commandName === "help") {
    try {
      await handleHelpAutocomplete(interaction);
    } catch (error) {
      logger.error("Help autocomplete failed:", error);
    }
  } else if (interaction.commandName === "setinstancetype") {
    try {
      await handleSetInstanceTypeAutocomplete(interaction);
    } catch (error) {
      logger.error("Set instance type autocomplete failed:", error);
    }
  }
};

const handleChatInputCommandInteraction = async (
  interaction: ChatInputCommandInteraction,
): Promise<void> => {
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
      await replyWithFailureMessage(
        interaction,
        "Something went wrong while processing this command. Please try again.",
      );
    } catch (replyError) {
      logger.error("Failed to send command error response:", replyError);
    }
  }
};

/**
 * Handles slash commands and primary action buttons on guild schedule output.
 * Button logs include `button`, `buttonLabel`, status, and the standard guild,
 * user, and parameter context; button interactions have an empty parameter list.
 */
client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isModalSubmit()) {
    await handleModalSubmitInteraction(interaction);
  } else if (interaction.isButton()) {
    await handleButtonInteraction(interaction);
  } else if (interaction.isStringSelectMenu()) {
    await handleSelectMenuInteraction(interaction);
  } else if (interaction.isAutocomplete()) {
    await handleAutocompleteInteraction(interaction);
  } else if (interaction.isChatInputCommand()) {
    await handleChatInputCommandInteraction(interaction);
  }
});

client.on(Events.Error, (error) => {
  logger.error("Discord client error:", error);
});

client.login(botToken);
