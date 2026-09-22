import type { ControlUiView } from "openclaw/plugin-sdk/control-ui";
import * as api from "../../../services/access/generated/sdk.gen.js";
import type { Person } from "../../../services/access/generated/types.gen.js";
import { page, element, button, confirm, dialog, failure } from "./page.js";

export const people: ControlUiView = (container, context) => {
  const view = page(container, context, "People");
  let currentId = "";
  let link: string | undefined;
  const refresh = () => view.run(load, "Refreshing people…");
  const inviteButton = button("Invite person", invite, "primary");
  inviteButton.hidden = true;
  view.header.append(
    button(
      "Refresh",
      () => {
        void refresh();
      },
      "btn--ghost",
    ),
    inviteButton,
  );
  const roleLabel = (id: string) =>
    id === "admin" ? "Administrator" : id === "member" ? "Member" : id;
  async function load() {
    if (!context.host.connection.canAdmin) {
      inviteButton.hidden = true;
      view.content.replaceChildren();
      throw new Error("Administrator access is required.");
    }
    const current = await view.session();
    currentId = current.user.id;
    const data = (await api.listPeople(view.request)).data;
    const invitations = current.enrollmentEnabled
      ? (await api.listInvitations(view.request)).data.invitations
      : [];
    if (context.signal.aborted || !context.host.connection.canAdmin) return;
    inviteButton.hidden = !(
      current.enrollmentEnabled && data.enrollment === "ready"
    );
    view.content.replaceChildren();
    if (current.links.length) {
      const navigation = element("nav");
      navigation.className = "clawscarf-actions";
      for (const link of current.links) {
        const anchor = element("a", link.label);
        anchor.href = link.href;
        navigation.append(anchor);
      }
      view.content.append(navigation);
    }
    if (current.enrollmentEnabled && data.enrollment !== "ready") {
      view.content.append(element("p", "Team access needs attention."));
      if (data.enrollment === "preparation_required")
        view.content.append(
          button("Prepare team access", () => {
            void view.run(async () => {
              await api.prepareTeam(view.write());
              await load();
            }, "Preparing team access…");
          }),
        );
    }
    const table = element("table");
    const head = element("thead");
    const row = element("tr");
    for (const label of ["Person", "Role", ""])
      row.append(element("th", label));
    head.append(row);
    table.append(head);
    const body = element("tbody");
    table.append(body);
    for (const person of data.people) {
      const tr = element("tr"),
        name = element("td"),
        role = element("td"),
        actions = element("td");
      const identity = element("div");
      identity.className = "clawscarf-identity";
      const avatar = element(
        "span",
        person.name
          .trim()
          .split(/\s+/u)
          .slice(0, 2)
          .map((part) => part[0])
          .join("")
          .toUpperCase(),
      );
      avatar.className = "clawscarf-avatar";
      avatar.setAttribute("aria-hidden", "true");
      const text = element("div");
      text.className = "clawscarf-identity-copy";
      const title = element("span", person.name);
      if (person.id === currentId) {
        const you = element("span", "You");
        you.className = "clawscarf-badge clawscarf-you";
        title.append(you);
      }
      text.append(title, element("small", person.email));
      identity.append(avatar, text);
      name.append(identity);
      const lastAdministrator =
        data.roles.some(
          (item) => item.id === person.role && item.administrator,
        ) &&
        !data.people.some(
          (other) =>
            other.id !== person.id &&
            data.roles.some(
              (item) => item.id === other.role && item.administrator,
            ),
        );
      const select = element("select");
      select.setAttribute("aria-label", `Role for ${person.name}`);
      if (!person.role || !data.roles.some((item) => item.id === person.role)) {
        const unknown = element("option", person.role ?? "Unavailable");
        unknown.value = person.role ?? "";
        select.append(unknown);
      }
      for (const item of data.roles) {
        const option = element("option", roleLabel(item.id));
        option.value = item.id;
        option.disabled = lastAdministrator && !item.administrator;
        select.append(option);
      }
      select.value = person.role ?? "";
      select.onchange = () => {
        const chosen = select.value;
        select.value = person.role ?? "";
        confirm(
          view,
          "Change role",
          `Change ${person.name}'s role to ${roleLabel(chosen)}?`,
          async () => {
            await api.setPersonRole({
              ...view.write(),
              path: { userId: person.id },
              body: { role: chosen, expectedRole: person.role },
            });
            await load();
          },
        );
      };
      role.append(select);
      if (lastAdministrator)
        role.append(element("small", "One administrator must remain."));
      const removeButton = button("Remove", () => remove(person), "btn--ghost");
      removeButton.disabled = lastAdministrator;
      if (lastAdministrator)
        removeButton.title =
          "Add another administrator before removing this person.";
      actions.append(removeButton);
      tr.append(name, role, actions);
      body.append(tr);
    }
    view.content.append(table);
    if (current.enrollmentEnabled) {
      const section = element("section");
      section.className = "clawscarf-invitations";
      const heading = element("header");
      heading.append(element("h3", "Invitations"));
      section.append(heading);
      if (link) {
        const input = element("input");
        input.readOnly = true;
        input.value = link;
        input.setAttribute("aria-label", "Invitation link");
        const share = element("div");
        share.className = "clawscarf-actions";
        share.append(
          input,
          button("Copy link", () => {
            void view.run(async () => {
              await navigator.clipboard.writeText(input.value);
            }, "Copying link…");
          }),
        );
        section.append(share);
      }
      if (!invitations.length) {
        const empty = element("p", "No pending invitations.");
        empty.className = "clawscarf-muted";
        section.append(empty);
      }
      const list = element("ul");
      for (const item of invitations) {
        const line = element("li");
        const details = element("div");
        details.append(
          element("span", item.email),
          element(
            "small",
            `Expires ${new Date(item.expiresAt).toLocaleString()}`,
          ),
        );
        const status = element(
          "span",
          item.status.charAt(0).toUpperCase() + item.status.slice(1),
        );
        status.className = "clawscarf-badge";
        line.append(details, status);
        if (item.status === "pending")
          line.append(
            button(
              "Revoke",
              () =>
                confirm(
                  view,
                  "Revoke invitation",
                  `Revoke the invitation for ${item.email}?`,
                  async () => {
                    await api.revokeInvitation({
                      ...view.write(),
                      path: { invitationId: item.id },
                    });
                    link = undefined;
                    await load();
                  },
                ),
              "btn--ghost",
            ),
          );
        list.append(line);
      }
      section.append(list);
      view.content.append(section);
    }
  }
  function remove(person: Person) {
    confirm(
      view,
      "Remove person",
      `Remove ${person.name}'s access? Their open connections will close. Team files remain.`,
      async () => {
        await api.removePerson({
          ...view.write(),
          path: { userId: person.id },
        });
        if (person.id === currentId)
          window.location.assign("/_clawscarf/signed-out");
        else await load();
      },
    );
  }
  function invite() {
    const form = element("form"),
      label = element("label", "Email"),
      email = element("input");
    email.type = "email";
    email.autofocus = true;
    email.required = true;
    email.maxLength = 320;
    label.append(email);
    const submit = element("button", "Create invitation");
    submit.type = "submit";
    submit.className = "btn primary";
    const modal = dialog(view, "Invite person", form);
    const error = element("p");
    error.setAttribute("role", "alert");
    modal.body.append(
      label,
      element("p", "Invited people join as members."),
      error,
    );
    modal.footer.append(button("Cancel", modal.close), submit);
    form.onsubmit = (event) => {
      event.preventDefault();
      const address = email.value;
      void view.run(async () => {
        error.textContent = "";
        submit.textContent = "Creating…";
        try {
          const result = await api.createInvitation({
            ...view.write(),
            body: { email: address },
          });
          link = result.data.url;
        } catch (cause) {
          error.textContent = failure(cause);
          return;
        } finally {
          submit.textContent = "Create invitation";
        }
        modal.close();
        await load();
      }, "Creating invitation…");
    };
    email.focus();
  }
  const unsubscribe = context.host.subscribe(() => {
    if (!context.host.connection.canAdmin) {
      inviteButton.hidden = true;
      view.content.replaceChildren();
      view.error.textContent = "Administrator access is required.";
    }
  });
  void view.run(load, "Loading people from OpenClaw…");
  return {
    dispose: () => {
      unsubscribe();
      view.dispose();
    },
  };
};
