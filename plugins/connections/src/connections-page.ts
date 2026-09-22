import packagedIcons from "../assets/icons.json" with { type: "json" };
import type { ControlUiView } from "openclaw/plugin-sdk/control-ui";
import {
  page,
  element,
  button,
  confirm,
  dialog,
  failure,
} from "../../common/native-page.js";
import { session } from "../../../services/access/generated/sdk.gen.js";
import * as api from "../../../services/connections/cloud/generated/sdk.gen.js";
import type {
  Connection,
  ConnectorAgentGrant,
} from "../../../services/connections/cloud/generated/types.gen.js";

export const connections: ControlUiView = (container, context) => {
  const view = page(
    container,
    context,
    "Connections",
    async (request) => (await session(request)).data,
  );
  const icons = new Map(Object.entries(packagedIcons));
  let items: Connection[] = [];
  let cursor: string | undefined;
  let query = "";
  const search = element("input");
  search.type = "search";
  search.hidden = true;
  search.placeholder = "Search connections";
  search.setAttribute("aria-label", "Search connections");
  search.oninput = () => {
    query = search.value.toLowerCase();
    render();
  };
  const addConnection = () => {
    void view.run(add, "Loading services…");
  };
  const addButton = button("Add connection", addConnection, "primary");
  view.header.append(
    button(
      "Refresh",
      () => {
        void view.run(load, "Refreshing connections…");
      },
      "btn--ghost",
    ),
    addButton,
  );
  const tableArea = element("div"),
    usageArea = element("details");
  usageArea.append(element("summary", "Usage"));
  view.content.append(search, tableArea, usageArea);
  const writes = (revision?: number) => ({
    ...view.write(),
    headers: {
      ...view.write().headers,
      "idempotency-key": crypto.randomUUID(),
      "if-match": `"${revision ?? 0}"`,
    },
  });
  async function load() {
    if (!context.host.connection.canAdmin) {
      view.content.replaceChildren();
      throw Error("Administrator access is required.");
    }
    await view.session();
    const result = (
      await api.listConnections({ ...view.request, query: { limit: 100 } })
    ).data;
    if (context.signal.aborted) return;
    items = result.items;
    cursor = result.nextCursor ?? undefined;
    render();
    usageArea.querySelector("div")?.remove();
    if (usageArea.open) await loadUsage();
  }
  async function more() {
    const result = (
      await api.listConnections({
        ...view.request,
        query: { limit: 100, ...(cursor ? { cursor } : {}) },
      })
    ).data;
    items.push(...result.items);
    cursor = result.nextCursor ?? undefined;
    render();
  }
  function render() {
    search.hidden = !items.length;
    addButton.hidden = !items.length;
    if (!items.length && !cursor) {
      const empty = element("div");
      empty.className = "clawscarf-empty";
      empty.append(
        element("h3", "Connect your team's services"),
        element("p", "Link an account so your agents can work with it."),
        button("Add connection", addConnection, "primary"),
      );
      tableArea.replaceChildren(empty);
      return;
    }
    const table = element("table"),
      head = element("thead"),
      row = element("tr"),
      body = element("tbody");
    table.className = "clawscarf-connections-table";
    for (const name of ["Connection", "Available to", "Status", ""])
      row.append(element("th", name));
    head.append(row);
    table.append(head, body);
    for (const item of items.filter((i) =>
      `${i.name} ${i.connectorId}`.toLowerCase().includes(query),
    )) {
      const tr = element("tr"),
        name = element("td"),
        actions = element("td");
      name.append(
        element("span", item.name),
        element("small", item.connectorId),
      );
      const state =
        item.setup &&
        ["creating", "pending", "verifying"].includes(item.setup.state)
          ? "Setup in progress"
          : {
              connected: "Connected",
              not_connected: "Not connected",
              needs_attention: "Needs attention",
              disconnected: "Disconnected",
            }[item.state];
      const status = element("td");
      const badge = element("span", state);
      badge.className = "clawscarf-badge";
      badge.dataset.state = item.state;
      status.append(badge);
      if (item.failure) status.append(element("small", item.failure.detail));
      const setup = item.setup;
      if (setup && ["creating", "pending", "verifying"].includes(setup.state)) {
        actions.append(
          button("Continue", () => {
            void view.run(
              () => continueSetup(item, setup.id),
              "Opening sign-in…",
            );
          }),
          button("Cancel setup", () =>
            confirm(
              view,
              "Cancel setup",
              `Cancel setup for ${item.name}?`,
              async () => {
                await api.cancelConnectionSetup({
                  ...writes(item.revision),
                  path: { connectionId: item.id, setupId: setup.id },
                });
                await load();
              },
            ),
          ),
        );
      } else
        actions.append(
          button(item.state === "connected" ? "Reconnect" : "Connect", () => {
            void view.run(() => connect(item), "Starting connection…");
          }),
        );
      actions.append(
        button("Edit", () => {
          void view.run(() => edit(item), "Loading agents…");
        }),
      );
      actions.append(
        button(
          item.state === "connected" ? "Disconnect" : "Remove",
          () =>
            confirm(
              view,
              item.state === "connected" ? "Disconnect" : "Remove",
              `${item.state === "connected" ? "Disconnect" : "Remove"} ${item.name}?`,
              async () => {
                await api.disconnectConnection({
                  ...writes(item.revision),
                  path: { connectionId: item.id },
                });
                await load();
              },
            ),
          "btn--ghost",
        ),
      );
      tr.append(
        name,
        element(
          "td",
          item.grant.mode === "all"
            ? "All agents"
            : item.grant.agentIds.join(", ") || "No agents",
        ),
        status,
        actions,
      );
      body.append(tr);
    }
    tableArea.replaceChildren(table);
    if (!body.children.length)
      tableArea.append(
        element(
          "p",
          items.length ? "No matching connections." : "No connections yet.",
        ),
      );
    if (cursor)
      tableArea.append(
        button("Load more", () => {
          void view.run(more, "Loading connections…");
        }),
      );
  }
  async function continueSetup(item: Connection, setupId: string) {
    const result = (
      await api.getConnectionSetup({
        ...view.request,
        path: { connectionId: item.id, setupId },
      })
    ).data;
    if (result.url) {
      window.location.assign(result.url);
      return;
    }
    await load();
    throw Error(
      result.setup.failure?.detail ??
        "Connection setup is not ready. Refresh and try again.",
    );
  }
  async function connect(item: Connection) {
    const result = (
      await api.startConnectionSetup({
        ...writes(item.revision),
        path: { connectionId: item.id },
        body: { kind: item.state === "connected" ? "reconnect" : "initial" },
      })
    ).data;
    if (result.url) {
      window.location.assign(result.url);
      return;
    }
    await load();
  }
  async function add() {
    const catalog = (
      await api.listConnectors({ ...view.request, query: { limit: 100 } })
    ).data;
    while (catalog.nextCursor) {
      const next = (
        await api.listConnectors({
          ...view.request,
          query: { limit: 100, cursor: catalog.nextCursor },
        })
      ).data;
      catalog.items.push(...next.items);
      catalog.nextCursor = next.nextCursor;
    }
    const filter = element("input"),
      list = element("div");
    list.className = "clawscarf-catalog";
    filter.type = "search";
    filter.autofocus = true;
    filter.placeholder = "Search services";
    filter.setAttribute("aria-label", "Search services");
    const modal = dialog(view, "Add connection");
    modal.body.classList.add("clawscarf-catalog-body");
    const category = element("select");
    category.setAttribute("aria-label", "Service category");
    const all = element("option", "All categories");
    all.value = "";
    category.append(all);
    for (const name of [
      ...new Set(catalog.items.map((item) => item.category)),
    ].sort((a, b) => a.localeCompare(b))) {
      const option = element("option", name);
      option.value = name;
      category.append(option);
    }
    const filters = element("div");
    filters.className = "clawscarf-catalog-filters";
    filters.append(filter, category);
    modal.body.append(filters, list);
    modal.footer.append(button("Cancel", modal.close));
    const show = () => {
      list.replaceChildren();
      const results = catalog.items
        .filter(
          (item) =>
            (!category.value || item.category === category.value) &&
            `${item.name} ${item.description} ${item.category}`
              .toLowerCase()
              .includes(filter.value.trim().toLowerCase()),
        )
        .sort(
          (a, b) =>
            a.category.localeCompare(b.category) ||
            a.name.localeCompare(b.name),
        );
      let group: HTMLElement | undefined;
      let previousCategory: string | undefined;
      for (const connector of results) {
        if (previousCategory !== connector.category) {
          group = element("section");
          group.append(element("h4", connector.category));
          list.append(group);
          previousCategory = connector.category;
        }
        const choose = button("", () => {
          modal.close();
          void view.run(async () => {
            const created = (
              await api.createConnection({
                ...writes(),
                body: {
                  connectorId: connector.id,
                  name: connector.name,
                  grant: { mode: "all" },
                },
              })
            ).data;
            await connect(created);
          }, "Starting connection…");
        });
        if (connector.iconUrl && icons.has(connector.iconUrl)) {
          const icon = element("img");
          icon.src = icons.get(connector.iconUrl) ?? "";
          icon.alt = "";
          icon.width = 24;
          icon.height = 24;
          icon.referrerPolicy = "no-referrer";
          choose.prepend(icon);
        }
        const text = element("span");
        text.className = "clawscarf-identity-copy";
        text.append(
          element("span", connector.name),
          element("small", connector.description),
        );
        choose.append(text);
        group?.append(choose);
      }
      if (!list.children.length) {
        const empty = element("p", "No matching services.");
        empty.className = "clawscarf-muted";
        list.append(empty);
      }
    };
    category.onchange = show;
    filter.oninput = show;
    show();
    filter.focus();
  }
  async function edit(item: Connection) {
    const agents = (await api.listConnectionAgents(view.request)).data.agents;
    const form = element("form"),
      name = element("input"),
      label = element("label", "Name");
    name.value = item.name;
    name.autofocus = true;
    name.required = true;
    name.maxLength = 120;
    label.append(name);
    const mode = element("select");
    mode.setAttribute("aria-label", "Available to");
    for (const [value, text] of [
      ["all", "All agents"],
      ["selected", "Selected agents"],
    ]) {
      const o = element("option", text);
      o.value = value ?? "";
      mode.append(o);
    }
    mode.value = item.grant.mode;
    const choices = element("fieldset");
    choices.append(element("legend", "Agents"));
    const selected = new Set(
      item.grant.mode === "selected" ? item.grant.agentIds : [],
    );
    for (const id of new Set([...agents.map((a) => a.id), ...selected])) {
      const box = element("input");
      box.type = "checkbox";
      box.checked = selected.has(id);
      box.onchange = () => {
        if (box.checked) selected.add(id);
        else selected.delete(id);
      };
      const l = element(
        "label",
        id + (agents.some((a) => a.id === id) ? "" : " (unavailable)"),
      );
      l.prepend(box);
      choices.append(l);
    }
    mode.onchange = () => {
      choices.hidden = mode.value === "all";
    };
    choices.hidden = mode.value === "all";
    const error = element("p");
    error.setAttribute("role", "alert");
    const access = element("label", "Available to");
    access.append(mode);
    const modal = dialog(view, "Edit connection", form);
    modal.body.append(label, access, choices, error);
    const save = element("button", "Save");
    save.type = "submit";
    save.className = "btn primary";
    modal.footer.append(button("Cancel", modal.close), save);
    form.onsubmit = (e) => {
      e.preventDefault();
      const grant: ConnectorAgentGrant =
        mode.value === "all"
          ? { mode: "all" }
          : { mode: "selected", agentIds: [...selected] };
      void view.run(async () => {
        error.textContent = "";
        save.textContent = "Saving…";
        try {
          await api.updateConnection({
            ...writes(item.revision),
            path: { connectionId: item.id },
            body: { name: name.value.trim(), grant },
          });
        } catch (cause) {
          error.textContent = failure(cause);
          return;
        } finally {
          save.textContent = "Save";
        }
        modal.close();
        await load();
      }, "Saving connection…");
    };
    name.focus();
  }
  usageArea.ontoggle = () => {
    if (!usageArea.open || usageArea.children.length > 1) return;
    void view.run(loadUsage, "Loading usage…");
  };
  async function loadUsage() {
    const usage = (await api.getConnectionUsage(view.request)).data;
    const rows = element("div");
    for (const item of usage.limits)
      rows.append(
        element(
          "p",
          `${item.installation ? "This installation" : "Cloud account"}${item.backend ? ` · ${item.backend}` : ""}: ${item.used.toLocaleString()} / ${item.limit.toLocaleString()} calls`,
        ),
      );
    rows.append(
      element("small", `Resets ${new Date(usage.resetsAt).toLocaleString()}`),
    );
    usageArea.append(rows);
  }
  const returned = new URLSearchParams(window.location.hash.slice(1));
  const receipt = returned.get("sessionUri"),
    connectionId = returned.get("connectionId"),
    setupId = returned.get("setupId");
  if (receipt)
    history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
  void view.run(
    async () => {
      await view.session();
      if (receipt && connectionId && setupId) {
        await api.completeConnectionSetup({
          ...view.write(),
          path: { connectionId, setupId },
          body: { sessionUri: receipt },
        });
      }
      await load();
    },
    receipt ? "Completing connection…" : "Loading connections…",
  );
  const unsubscribe = context.host.subscribe(() => {
    if (!context.host.connection.canAdmin) {
      view.content.replaceChildren();
      view.error.textContent = "Administrator access is required.";
    }
  });
  return {
    dispose: () => {
      unsubscribe();
      view.dispose();
    },
  };
};
