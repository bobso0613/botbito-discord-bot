import "dotenv/config";
import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  ActivityType,
  type ChatInputCommandInteraction,
} from "discord.js";
import { commands } from "./commands/index.js";
import { registerGuildScheduleAnnouncementListener } from "./services/guild-schedule-announcement.service.js";
import { logger } from "./utils/logger.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token) {
  throw new Error("DISCORD_TOKEN must be set");
}

const botToken = token;
logger.log("Bot process started.");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});
registerGuildScheduleAnnouncementListener(client);
const commandsByName = new Collection(
  commands.map((command) => [command.data.name, command]),
);

const getCommandLogContext = (
  interaction: ChatInputCommandInteraction,
): string => {
  return [
    `guildName=${JSON.stringify(interaction.guild?.name ?? "direct-message")}`,
    `username=${JSON.stringify(interaction.user.username)}`,
    `parameters=${JSON.stringify(interaction.options.data)}`,
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

client.on(Events.InteractionCreate, async (interaction) => {
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
