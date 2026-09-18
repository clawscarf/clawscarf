import { Command } from "commander";
import { sessionRequest } from "./session.js";
import * as api from "../services/access/generated/sdk.gen.js";
import { writeResult } from "./output.js";

export function peopleCommand(program: Command) {
  const command = new Command("people")
    .description("Manage people and invitations as a signed-in administrator")
    .requiredOption("--origin <url>", "Server origin")
    .requiredOption(
      "--session-file <path>",
      "Private file containing your session credential",
    );
  const request = () =>
    sessionRequest(command.opts<{ origin: string; sessionFile: string }>());
  command.command("list").action(async () => {
    const result = (await api.listPeople(await request())).data;
    writeResult(
      program,
      result,
      result.people
        .map(
          (person) =>
            `${person.name} <${person.email}> · ${person.role ?? "Unavailable"} · ${person.id}`,
        )
        .join("\n"),
    );
  });
  command.command("invite <email>").action(async (email: string) => {
    const result = (
      await api.createInvitation({ ...(await request()), body: { email } })
    ).data;
    writeResult(
      program,
      result,
      `Invitation for ${email}\n${result.url}\nExpires ${result.invitation.expiresAt}`,
    );
  });
  command.command("invitations").action(async () => {
    const result = (await api.listInvitations(await request())).data;
    writeResult(
      program,
      result,
      result.invitations
        .map((item) => `${item.email} · ${item.status} · ${item.id}`)
        .join("\n") || "No invitations.",
    );
  });
  command
    .command("revoke-invitation <id>")
    .action(async (invitationId: string) => {
      await api.revokeInvitation({
        ...(await request()),
        path: { invitationId },
      });
      writeResult(program, { revoked: true }, "Invitation revoked.");
    });
  command
    .command("role <userId> <role>")
    .requiredOption("--expected-role <role>", "Previously observed native role")
    .action(
      async (
        userId: string,
        role: string,
        options: { expectedRole: string },
      ) => {
        await api.setPersonRole({
          ...(await request()),
          path: { userId },
          body: { role, expectedRole: options.expectedRole },
        });
        writeResult(program, { updated: true }, "Role updated.");
      },
    );
  command.command("remove <userId>").action(async (userId: string) => {
    await api.removePerson({ ...(await request()), path: { userId } });
    writeResult(
      program,
      { removed: true },
      "Access removed. Team files remain.",
    );
  });
  return command;
}
