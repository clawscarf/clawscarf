import * as clack from "@clack/prompts";
import { InstallationError } from "../errors.js";

export class InstallerCancelled extends Error {}
export type Choice = { value: string; label: string; hint?: string };
export interface InstallerPrompts {
  text(
    message: string,
    initial?: string,
    validate?: (
      value: string,
    ) => string | undefined | Promise<string | undefined>,
  ): Promise<string>;
  select(message: string, choices: Choice[]): Promise<string>;
  multiselect(message: string, choices: Choice[]): Promise<string[]>;
  confirm(message: string): Promise<boolean>;
  note(message: string, title: string): void;
}

function answer<T>(value: T | symbol): T {
  if (typeof value === "symbol") throw new InstallerCancelled();
  return value;
}
export const terminalPrompts: InstallerPrompts = {
  async text(message, initial, validate) {
    return answer<string>(
      await clack.text({
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
  async select(message, options) {
    return answer<string>(await clack.select({ message, options }));
  },
  async multiselect(message, options) {
    return answer<string[]>(
      await clack.multiselect({ message, options, required: true }),
    );
  },
  async confirm(message) {
    return answer<boolean>(
      await clack.confirm({ message, initialValue: false }),
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
