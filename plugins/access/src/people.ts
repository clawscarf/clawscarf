import type { ControlUiView } from "openclaw/plugin-sdk/control-ui";
import * as api from "../../../services/access/generated/sdk.gen.js";
import type { Person } from "../../../services/access/generated/types.gen.js";
import { page, element, button, confirm } from "./page.js";

export const people: ControlUiView = (container, context) => {
  const view = page(container, context, "People");
  let canInvite = false;
  let currentId = "";
  let link: string | undefined;
  const refresh = () => view.run(load, "Refreshing people…");
  view.header.append(
    button("Refresh", () => {
      void refresh();
    }),
  );
  async function load() {
    if (!context.host.connection.canAdmin) {
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
    canInvite = current.enrollmentEnabled && data.enrollment === "ready";
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
      name.append(
        element(
          "span",
          person.name + (person.id === currentId ? " (you)" : ""),
        ),
        element("small", person.email),
      );
      const select = element("select");
      select.setAttribute("aria-label", `Role for ${person.name}`);
      if (!person.role || !data.roles.some((item) => item.id === person.role)) {
        const unknown = element("option", person.role ?? "Unavailable");
        unknown.value = person.role ?? "";
        select.append(unknown);
      }
      for (const item of data.roles) {
        const option = element("option", item.id);
        option.value = item.id;
        select.append(option);
      }
      select.value = person.role ?? "";
      select.onchange = () => {
        const chosen = select.value;
        select.value = person.role ?? "";
        confirm(
          view,
          "Change role",
          `Change ${person.name}'s role to ${chosen}?`,
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
      actions.append(button("Remove", () => remove(person)));
      tr.append(name, role, actions);
      body.append(tr);
    }
    view.content.append(table);
    if (current.enrollmentEnabled) {
      const section = element("section");
      const heading = element("header");
      heading.append(element("h3", "Invitations"));
      if (canInvite) heading.append(button("Invite person", invite));
      section.append(heading);
      if (link) {
        const input = element("input");
        input.readOnly = true;
        input.value = link;
        input.setAttribute("aria-label", "Invitation link");
        section.append(
          input,
          button("Copy link", () => {
            void view.run(async () => {
              await navigator.clipboard.writeText(input.value);
            }, "Copying link…");
          }),
        );
      }
      if (!invitations.length) section.append(element("p", "No invitations."));
      for (const item of invitations) {
        const line = element("p");
        line.append(
          element("span", item.email),
          element(
            "small",
            `${item.status} · ${new Date(item.expiresAt).toLocaleString()}`,
          ),
        );
        if (item.status === "pending")
          line.append(
            button("Revoke", () =>
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
            ),
          );
        section.append(line);
      }
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
    email.required = true;
    email.maxLength = 320;
    label.append(email);
    const submit = element("button", "Create invitation");
    submit.type = "submit";
    submit.className = "btn";
    form.append(label, element("p", "Invited people join as members."), submit);
    const mount = element("div");
    view.root.append(mount);
    const close = () => {
      dialog.dispose();
      mount.remove();
    };
    form.append(button("Cancel", close));
    const dialog = context.host.components.mountDialog(mount, {
      label: "Invite person",
      content: form,
      onCancel: () => {
        close();
      },
    });
    form.onsubmit = (event) => {
      event.preventDefault();
      const address = email.value;
      close();
      void view.run(async () => {
        const result = await api.createInvitation({
          ...view.write(),
          body: { email: address },
        });
        link = result.data.url;
        await load();
      }, "Creating invitation…");
    };
    email.focus();
  }
  const unsubscribe = context.host.subscribe(() => {
    if (!context.host.connection.canAdmin) {
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
