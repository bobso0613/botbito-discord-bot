import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commands } from "./commands/index.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;

if (!token || !clientId) {
  throw new Error("DISCORD_TOKEN and DISCORD_CLIENT_ID must be set");
}

const rest = new REST().setToken(token);
const body = commands.map((command) => command.data.toJSON());

await rest.put(Routes.applicationCommands(clientId), { body });
console.log(
  `Registered ${body.length} global slash command(s). Global updates can take up to 1 hour to appear.`,
);
