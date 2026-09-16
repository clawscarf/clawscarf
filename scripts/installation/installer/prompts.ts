import type { Key } from "node:readline";
import * as clack from "@clack/prompts";
import { InstallationError } from "../errors.js";

export class InstallerCancelled extends Error {}
export class SectionCancelled extends Error {}
export type Choice = { value: string; label: string; hint?: string };
export interface InstallerPrompts {
  text(
    message: string,
    initial?: string,
    validate?: (
      value: string,
    ) => string | undefined | Promise<string | undefined>,
  ): Promise<string>;
  password(message: string): Promise<string>;
  select(message: string, choices: Choice[], initial?: string): Promise<string>;
  multiselect(message: string, choices: Choice[]): Promise<string[]>;
  confirm(message: string): Promise<boolean>;
  note(message: string, title: string): void;
}

async function answer<T>(work: () => Promise<T | symbol>): Promise<T> {
  const navigation = { back: false };
  const keypress = (_text: string, key: Key) => {
    if (key.name === "escape") navigation.back = true;
  };
  process.stdin.on("keypress", keypress);
  try {
    const value = await work();
    if (typeof value === "symbol") {
      if (navigation.back) throw new SectionCancelled();
      throw new InstallerCancelled();
    }
    return value;
  } finally {
    process.stdin.off("keypress", keypress);
  }
}
export const terminalPrompts: InstallerPrompts = {
  async text(message, initial, validate) {
    return answer<string>(() =>
      clack.text({
        message,
        ...(initial === undefined ? {} : { initialValue: initial }),
        validate: (value) =>
          validate
            ? validate(value ?? "")
            : value?.trim()
              ? undefined
              : "Enter a value.",
      }),
    );
  },
  async password(message) {
    return answer<string>(() =>
      clack.password({
        message,
        validate: (value) => (value?.trim() ? undefined : "Enter a value."),
      }),
    );
  },
  async select(message, options, initial) {
    return answer<string>(() =>
      clack.select({
        message,
        options,
        ...(initial === undefined ? {} : { initialValue: initial }),
      }),
    );
  },
  async multiselect(message, options) {
    return answer<string[]>(() =>
      clack.multiselect({ message, options, required: true }),
    );
  },
  async confirm(message) {
    return answer<boolean>(() =>
      clack.confirm({ message, initialValue: false }),
    );
  },
  note: clack.note,
};

export function requireTerminal() {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new InstallationError(
      "invalid_configuration",
      "The installer needs an interactive terminal. For unattended setup use validate, plan, apply and start with an installation document.",
    );
}

export async function progress<T>(
  message: string,
  work: () => Promise<T>,
): Promise<T> {
  const spinner = clack.spinner({
    onCancel: () => {
      clack.log.info(
        "Cancellation requested. Waiting for the current operation to settle; no following step will start.",
      );
    },
  });
  spinner.start(message);
  try {
    const result = await work();
    if (spinner.isCancelled) throw new InstallerCancelled();
    spinner.stop(message);
    return result;
  } catch (error) {
    spinner.error("Could not complete this step.");
    throw error;
  }
}
