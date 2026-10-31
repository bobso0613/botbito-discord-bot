import type { Command } from "../types/command.js";
import { exportCommand } from "./export.command.js";
import { guildSettingCommand } from "./guildsetting.command.js";
import { guildSchedCommand } from "./guildsched.command.js";
import { helpCommand } from "./help.command.js";
import { myCooldowsCommand } from "./mycooldowns.command.js";
import { mySchedCommand } from "./mysched.command.js";
import { payoutCommand } from "./payout.command.js";
import { payoutSummaryCommand } from "./payout-summary.command.js";
import {
  changeShareParticipantsCommand,
  changeShareVendorCommand,
} from "./payout-thread.command.js";
import { signupCommands } from "./signup.command.js";

export const commands: Command[] = [
  exportCommand,
  guildSettingCommand,
  payoutCommand,
  payoutSummaryCommand,
  changeShareVendorCommand,
  changeShareParticipantsCommand,
  guildSchedCommand,
  mySchedCommand,
  myCooldowsCommand,
  helpCommand,
  ...signupCommands,
];
