import "dotenv/config";
import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
} from "discord.js";
import { commands } from "./commands/index.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token) {
  throw new Error("DISCORD_TOKEN must be set");
}

const botToken = token;

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});
const commandsByName = new Collection(
  commands.map((command) => [command.data.name, command]),
);

const registerGuildSlashCommands = async (guildId: string): Promise<void> => {
  if (!clientId) {
    console.warn(
      "DISCORD_CLIENT_ID is not set; skipping slash command registration.",
    );
    return;
  }

  const commandBody = commands
    .filter(
      (command) => !command.guildIds || command.guildIds.includes(guildId),
    )
    .map((command) => command.data.toJSON());
  const rest = new REST().setToken(botToken);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commandBody,
  });
  console.log(
    `Registered ${commandBody.length} slash command(s) for guild ${guildId}.`,
  );
};

client.once(Events.ClientReady, async (readyClient) => {
  for (const guildId of readyClient.guilds.cache.keys()) {
    await registerGuildSlashCommands(guildId);
  }
  console.log(`Logged in as ${readyClient.user.tag}`);
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
  } catch (error) {
    console.error(`Failed to execute /${interaction.commandName}:`, error);

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
      console.error("Failed to send command error response:", replyError);
    }
  }
});

client.on(Events.Error, (error) => {
  console.error("Discord client error:", error);
});

client.login(botToken);
