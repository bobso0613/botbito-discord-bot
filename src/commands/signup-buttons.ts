import {
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  type ButtonInteraction,
} from "discord.js";
import {
  SIGNUP_MODAL_ADD_ID,
  SIGNUP_MODAL_CHARNOTE_ID,
  SIGNUP_MODAL_REMOVE_CHARNOTE_ID,
  SIGNUP_MODAL_REMOVE_ID,
  SIGNUP_MODAL_SWAP_ID,
  SIGNUP_MODAL_TBC_ID,
} from "../constants/signup.js";
import { executeWhen } from "../services/signup-actions.service.js";
import { input } from "../services/signup-setup.service.js";
import { SIGNUP_COMMANDS_HELP_TEXT } from "../templates/signup-sheet.template.js";

/** Replies ephemerally with the full signup command reference; used by the "Show list of commands" button. */
export const handleSignupInfoButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  await interaction.reply({
    content: SIGNUP_COMMANDS_HELP_TEXT,
    flags: MessageFlags.Ephemeral,
  });
};

/** Shows the modal to sign up for a slot or reserve. */
export const handleSignupAddButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  const modal = new ModalBuilder()
    .setCustomId(SIGNUP_MODAL_ADD_ID)
    .setTitle("Sign up for a slot")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Slot, random, or reserve (optional: @user)")
        .setTextInputComponent(
          input("input", "e.g. 1, 2, random, or reserve", true),
        ),
      new LabelBuilder()
        .setLabel("Character name (optional)")
        .setTextInputComponent(input("char", "e.g. Paladin", false)),
      new LabelBuilder()
        .setLabel("TBC (optional: true or false)")
        .setTextInputComponent(input("tbc", "false", false)),
    );
  await interaction.showModal(modal);
};

/** Shows the modal to remove a signup or reserve. */
export const handleSignupRemoveButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  const modal = new ModalBuilder()
    .setCustomId(SIGNUP_MODAL_REMOVE_ID)
    .setTitle("Remove signup or reserve")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Position(s) (optional)")
        .setDescription("Leave blank to remove all your signups/reserves")
        .setTextInputComponent(
          input("position", "e.g. 1, 2, or reserve", false),
        ),
    );
  await interaction.showModal(modal);
};

/** Shows the modal to toggle TBC status on slot(s), reserve(s), or yourself. */
export const handleSignupTbcButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  const modal = new ModalBuilder()
    .setCustomId(SIGNUP_MODAL_TBC_ID)
    .setTitle("Toggle TBC")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Slot number(s) (optional)")
        .setDescription("Leave blank to toggle your own TBC status")
        .setTextInputComponent(input("input", "e.g. 1, 2", false)),
    );
  await interaction.showModal(modal);
};

/** Shows the modal to set a character note on a slot or reserve. */
export const handleSignupCharNoteButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  const modal = new ModalBuilder()
    .setCustomId(SIGNUP_MODAL_CHARNOTE_ID)
    .setTitle("Set character note")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Character note")
        .setTextInputComponent(input("note", "e.g. HP 3x, Alt, DPS", true)),
      new LabelBuilder()
        .setLabel("Slot number (optional)")
        .setDescription("Leave blank for your own slot/reserve")
        .setTextInputComponent(input("position", "e.g. 1", false)),
    );
  await interaction.showModal(modal);
};

/** Shows the modal to remove character notes from slots or reserves. */
export const handleSignupRemoveCharNoteButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  const modal = new ModalBuilder()
    .setCustomId(SIGNUP_MODAL_REMOVE_CHARNOTE_ID)
    .setTitle("Remove character notes")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Slot number(s) (optional)")
        .setDescription("Leave blank to remove all your character notes")
        .setTextInputComponent(input("input", "e.g. 1, 2", false)),
    );
  await interaction.showModal(modal);
};

/** Shows the modal to swap slots or move to reserves. */
export const handleSignupSwapButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  const modal = new ModalBuilder()
    .setCustomId(SIGNUP_MODAL_SWAP_ID)
    .setTitle("Swap slot")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("First slot (or reserve / random)")
        .setTextInputComponent(
          input("first", "e.g. 1, random, or reserve", true),
        ),
      new LabelBuilder()
        .setLabel("Second slot (optional)")
        .setDescription("Leave blank if joining slot 1 as yourself")
        .setTextInputComponent(input("second", "e.g. 2 or reserve", false)),
    );
  await interaction.showModal(modal);
};

/** Replies ephemerally with the run's schedule; used by the "Show schedule" button. */
export const handleSignupWhenButton = async (
  interaction: ButtonInteraction,
): Promise<void> => {
  await executeWhen(interaction);
};
