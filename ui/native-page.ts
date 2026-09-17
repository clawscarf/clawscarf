export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
export function button(label: string, run: () => void) {
  const node = element("button", label);
  node.type = "button";
  node.className = "btn";
  node.onclick = run;
  return node;
}
export function failure(error: unknown) {
  return typeof error === "object" &&
    error !== null &&
    "detail" in error &&
    typeof error.detail === "string"
    ? error.detail
    : error instanceof Error
      ? error.message
      : "Could not complete the request. Refresh and try again.";
}
/** Native page lifetime owns reads; submitted mutations are never automatically replayed. */
export interface PageContext {
  signal: AbortSignal;
  host: {
    components: {
      mountDialog(
        container: HTMLElement,
        options: { label: string; content: HTMLElement; onCancel: () => void },
      ): { dispose(): void };
    };
  };
}
export function page<T extends { csrfToken: string }>(
  container: HTMLElement,
  context: PageContext,
  title: string,
  loadSession: (request: {
    baseUrl: string;
    credentials: "same-origin";
    throwOnError: true;
    signal: AbortSignal;
  }) => Promise<T>,
) {
  const root = element("section");
  root.className = "clawscarf-page";
  const style = element(
    "style",
    `
    .clawscarf-page{max-width:960px;margin:24px auto;padding:0 16px;display:grid;gap:20px}
    .clawscarf-page header,.clawscarf-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
    .clawscarf-page header h2{flex:1;margin:0}.clawscarf-page table{width:100%;border-collapse:collapse}
    .clawscarf-page th,.clawscarf-page td{text-align:left;padding:12px;border-bottom:1px solid var(--border);overflow-wrap:anywhere}
    .clawscarf-page small{display:block;color:var(--muted);margin-top:4px}.clawscarf-page [role=alert]{color:var(--danger)}
    .clawscarf-page [role=status]:not(:empty)::before{content:'◌';display:inline-block;margin-right:8px;animation:clawscarf-spin 1s linear infinite}
    .clawscarf-page [role=alert]:empty,.clawscarf-page [role=status]:empty{display:none}
    .clawscarf-page input,.clawscarf-page select{font:inherit;max-width:100%;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:inherit}
    .clawscarf-page label{display:grid;gap:8px}
    .clawscarf-page input[readonly]{width:100%}.clawscarf-page form{display:grid;gap:16px}
    .clawscarf-catalog{display:grid;gap:8px;margin-top:12px;max-height:55vh;overflow:auto}
    .clawscarf-catalog .btn{display:block;text-align:left;white-space:normal;padding:12px}
    .clawscarf-catalog img{vertical-align:middle;margin-right:8px}
    .clawscarf-page td .btn{margin:2px}
    @media(max-width:600px){
      .clawscarf-connections-table thead{display:none}
      .clawscarf-connections-table tbody{display:grid;gap:12px;margin-top:16px}
      .clawscarf-connections-table tr{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--border);border-radius:10px;padding:12px;gap:8px}
      .clawscarf-connections-table td{border:0;padding:0!important;overflow-wrap:normal}
      .clawscarf-connections-table td:first-child{grid-column:1/-1;font-weight:600}
      .clawscarf-connections-table td:last-child{grid-column:1/-1;width:auto!important}
    }
    @keyframes clawscarf-spin{to{transform:rotate(360deg)}}
    @media(prefers-reduced-motion:reduce){.clawscarf-page [role=status]::before{animation:none}}
    @media(max-width:600px){.clawscarf-page th,.clawscarf-page td{padding:8px 4px}.clawscarf-page td:last-child{width:1%}}
  `,
  );
  const header = element("header");
  header.append(element("h2", title));
  const status = element("p");
  status.setAttribute("role", "status");
  const error = element("p");
  error.setAttribute("role", "alert");
  const content = element("div");
  root.append(style, header, status, error, content);
  container.replaceChildren(root);
  const request = {
    baseUrl: window.location.origin,
    credentials: "same-origin",
    throwOnError: true,
    signal: context.signal,
  } as const;
  let csrf = "";
  let busy = false;
  function pending(value: boolean, text = "") {
    busy = value;
    status.textContent = text;
    content.setAttribute("aria-busy", String(value));
    for (const control of root.querySelectorAll<
      HTMLButtonElement | HTMLSelectElement
    >("button,select"))
      control.disabled = value;
  }
  async function session() {
    const value = await loadSession(request);
    csrf = value.csrfToken;
    return value;
  }
  async function run(work: () => Promise<void>, label: string) {
    if (busy || context.signal.aborted) return;
    pending(true, label);
    error.textContent = "";
    try {
      await work();
    } catch (cause) {
      if (!context.signal.aborted) error.textContent = failure(cause);
    } finally {
      if (!context.signal.aborted) pending(false);
    }
  }
  return {
    root,
    header,
    content,
    context,
    request,
    session,
    run,
    error,
    write: () => ({ ...request, headers: { "x-csrf-token": csrf } }),
    dispose: () => root.remove(),
  };
}
export type Page = ReturnType<typeof page>;

export function confirm(
  page: Page,
  label: string,
  message: string,
  action: () => Promise<void>,
) {
  const content = element("div");
  content.append(element("p", message));
  const mount = element("div");
  page.root.append(mount);
  const close = () => {
    dialog.dispose();
    mount.remove();
  };
  content.append(
    button("Cancel", close),
    button(label, () => {
      close();
      void page.run(action, "Saving…");
    }),
  );
  const dialog = page.context.host.components.mountDialog(mount, {
    label,
    content,
    onCancel: () => {
      close();
    },
  });
}
