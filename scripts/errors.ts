/** Deliberate operator diagnostics only. Never wrap raw subprocess or provider messages. */
export class OperatorError extends Error {
  constructor(
    message: string,
    readonly code: string = "operation_failed",
  ) {
    super(message);
    this.name = "OperatorError";
  }
}
