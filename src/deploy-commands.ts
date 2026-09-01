import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commands } from "./commands/index.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID must be set");
}

const rest = new REST().setToken(token);
const globalCommandBody = commands
  .filter((command) => !command.guildIds)
  .map((command) => command.data.toJSON());
const guildIds = [
  ...new Set(commands.flatMap((command) => command.guildIds ?? [])),
];

await rest.put(Routes.applicationCommands(clientId), {
  body: globalCommandBody,
});

for (const guildId of guildIds) {
  const guildCommandBody = commands
    .filter(
      (command) => !command.guildIds || command.guildIds.includes(guildId),
    )
    .map((command) => command.data.toJSON());

  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: guildCommandBody,
  });
}

console.log(
  `Registered ${globalCommandBody.length} global and guild-specific slash command(s) for ${guildIds.length} guild(s).`,
);
