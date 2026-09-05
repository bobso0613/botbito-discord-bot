import type { Command } from "../types/command.js";
import { guildSchedCommand } from "./guildsched.command.js";
import { helpCommand } from "./help.command.js";
import { myCooldowsCommand } from "./mycooldowns.command.js";
import { mySchedCommand } from "./mysched.command.js";
import { payoutCommand } from "./payout.command.js";
import { payoutSummaryCommand } from "./payout-summary.command.js";

export const commands: Command[] = [
  payoutCommand,
  payoutSummaryCommand,
  guildSchedCommand,
  mySchedCommand,
  myCooldowsCommand,
  helpCommand,
];
