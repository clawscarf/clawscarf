export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}
export function button(label: string, run: () => void, variant = "") {
  const node = element("button", label);
  node.type = "button";
  node.className = `btn ${variant}`.trim();
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
        options: {
          label: string;
          content: HTMLElement;
          onCancel: () => boolean | void;
        },
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
    .clawscarf-page{max-width:960px;margin:24px auto;padding:0 20px;display:grid;gap:24px}
    .clawscarf-page [hidden]{display:none!important}
    .clawscarf-page header,.clawscarf-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
    .clawscarf-page header h2,.clawscarf-page header h3{flex:1;margin:0}
    .clawscarf-page table{width:100%;border-collapse:collapse}
    .clawscarf-page th,.clawscarf-page td{text-align:left;padding:16px 12px;border-bottom:1px solid var(--border);overflow-wrap:anywhere}
    .clawscarf-page th{font-size:12px;font-weight:500;color:var(--muted)}
    .clawscarf-page td:last-child{text-align:right}
    .clawscarf-page small,.clawscarf-muted{color:var(--muted)}
    .clawscarf-page small{display:block;margin-top:4px}
    .clawscarf-page [role=alert]{color:var(--danger)}
    .clawscarf-page [role=status]:not(:empty)::before{content:'◌';display:inline-block;margin-right:8px;animation:clawscarf-spin 1s linear infinite}
    .clawscarf-page [role=alert]:empty,.clawscarf-page [role=status]:empty{display:none}
    .clawscarf-page input,.clawscarf-page select{box-sizing:border-box;font:inherit;max-width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--bg);color:inherit}
    .clawscarf-page input[type=search]{width:100%}
    .clawscarf-page label{display:grid;gap:8px}
    .clawscarf-page input[readonly]{width:100%}
    .clawscarf-actions input[readonly]{flex:1;min-width:0;width:auto}
    .clawscarf-page form,.clawscarf-page-content{display:grid;gap:20px}
    .clawscarf-page fieldset label{display:flex;align-items:center;margin:8px 0}
    .clawscarf-page .clawscarf-dialog{box-sizing:border-box;background:var(--card);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-xl);box-shadow:0 16px 64px #0003;max-height:min(720px,calc(100dvh - 64px));display:flex;flex-direction:column;gap:0;overflow:hidden}
    .clawscarf-dialog header{padding:20px 24px 12px;flex:none}
    .clawscarf-dialog h3{font-size:18px}
    .clawscarf-dialog-body{padding:8px 24px 24px;display:grid;gap:16px;overflow:auto;min-height:0}
    .clawscarf-dialog-body p{margin:0}
    .clawscarf-dialog-footer{display:flex;justify-content:flex-end;gap:8px;padding:16px 24px;border-top:1px solid var(--border);flex:none}
    .clawscarf-dialog-footer:empty{display:none}
    .clawscarf-dialog .clawscarf-catalog-body{display:flex;flex-direction:column;overflow:hidden}
    .clawscarf-catalog-filters{display:grid;grid-template-columns:minmax(0,1fr) 180px;gap:12px}
    .clawscarf-catalog h4{margin:20px 8px 4px;color:var(--muted);font-size:12px;font-weight:600}
    .clawscarf-catalog section:first-child h4{margin-top:0}
    .clawscarf-catalog{overflow:auto;min-height:0;max-height:50vh}
    .clawscarf-page .clawscarf-catalog .btn{display:flex;width:100%;justify-content:flex-start;text-align:left;white-space:normal;padding:14px 8px;gap:12px;border:0;border-bottom:1px solid var(--border);border-radius:0;background:transparent;box-shadow:none}
    .clawscarf-page .clawscarf-catalog .btn:hover{background:var(--bg-hover)}
    .clawscarf-catalog .clawscarf-identity-copy small{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .clawscarf-identity{display:flex;align-items:center;gap:12px;min-width:0}
    .clawscarf-identity-copy{min-width:0;flex:1;text-align:left}
    .clawscarf-avatar{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:var(--secondary);color:var(--muted);font-size:12px;font-weight:600;flex:none}
    .clawscarf-identity img,.clawscarf-catalog img{flex:none;object-fit:contain}
    .clawscarf-badge{display:inline-block;padding:3px 8px;border-radius:var(--radius-full);font-size:12px;background:var(--secondary);color:var(--muted);white-space:nowrap}
    .clawscarf-you{margin-left:8px}
    .clawscarf-badge[data-state=connected]{background:var(--ok-subtle);color:var(--ok)}
    .clawscarf-badge[data-state=needs_attention]{background:var(--warn-subtle);color:var(--warn)}
    .clawscarf-empty{padding:48px 24px;text-align:center;border:1px dashed var(--border);border-radius:var(--radius-lg)}
    .clawscarf-empty h3{margin:0 0 8px}.clawscarf-empty p{margin:0 0 20px;color:var(--muted)}
    .clawscarf-invitations{display:grid;gap:16px;margin-top:12px}
    .clawscarf-invitations ul{list-style:none;padding:0;margin:0}
    .clawscarf-invitations li{display:flex;align-items:center;gap:16px;padding:16px 0;border-bottom:1px solid var(--border);flex-wrap:wrap}
    .clawscarf-invitations li>div:first-child{flex:1;min-width:160px;overflow-wrap:anywhere}
    .clawscarf-page td .btn{margin:2px}
    @media(max-width:600px){
      .clawscarf-catalog-filters{grid-template-columns:1fr}
      .clawscarf-page{padding:0 12px;margin:16px auto}
      .clawscarf-dialog header{padding:16px 16px 8px}
      .clawscarf-dialog-body{padding:8px 16px 20px}
      .clawscarf-dialog-footer{padding:12px 16px}
      .clawscarf-page table thead{display:none}
      .clawscarf-page tbody{display:grid;gap:12px}
      .clawscarf-page tr{display:grid;grid-template-columns:minmax(0,1fr) auto;border:1px solid var(--border);border-radius:var(--radius-md);padding:12px;gap:12px}
      .clawscarf-page td{border:0;padding:0;min-width:0}
      .clawscarf-page td:first-child{grid-column:1/-1}
      .clawscarf-connections-table td:last-child{grid-column:1/-1;text-align:left}
    }
    @keyframes clawscarf-spin{to{transform:rotate(360deg)}}
    @media(prefers-reduced-motion:reduce){.clawscarf-page [role=status]::before{animation:none}}
  `,
  );
  const header = element("header");
  header.append(element("h2", title));
  const status = element("p");
  status.setAttribute("role", "status");
  const error = element("p");
  error.setAttribute("role", "alert");
  const content = element("div");
  content.className = "clawscarf-page-content";
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
  const disabled = new Map<
    HTMLButtonElement | HTMLSelectElement | HTMLInputElement,
    boolean
  >();
  let focused:
    HTMLButtonElement | HTMLSelectElement | HTMLInputElement | undefined;
  function pending(value: boolean, text = "") {
    busy = value;
    status.textContent = text;
    content.setAttribute("aria-busy", String(value));
    if (value) {
      for (const control of root.querySelectorAll<
        HTMLButtonElement | HTMLSelectElement | HTMLInputElement
      >("button,select,input")) {
        if (control === document.activeElement) focused = control;
        disabled.set(control, control.disabled);
        control.disabled = true;
      }
    } else {
      for (const [control, wasDisabled] of disabled)
        control.disabled = wasDisabled;
      disabled.clear();
      if (
        focused?.isConnected &&
        !focused.disabled &&
        document.activeElement === document.body
      )
        focused.focus();
      focused = undefined;
    }
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
    get busy() {
      return busy;
    },
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

/** OpenClaw owns modal behavior; the plugin supplies its visible panel. */
export function dialog(
  page: Page,
  label: string,
  panel: HTMLElement = element("div"),
) {
  panel.className = "clawscarf-dialog";
  const header = element("header");
  const body = element("div");
  body.className = "clawscarf-dialog-body";
  const footer = element("div");
  footer.className = "clawscarf-dialog-footer";
  const mount = element("div");
  page.root.append(mount);
  const close = () => {
    handle.dispose();
    mount.remove();
  };
  const dismiss = button("×", close, "btn--ghost");
  dismiss.setAttribute("aria-label", `Close ${label.toLowerCase()}`);
  header.append(element("h3", label), dismiss);
  panel.append(header, body, footer);
  const handle = page.context.host.components.mountDialog(mount, {
    label,
    content: panel,
    onCancel: () => {
      if (!page.busy) close();
      return false;
    },
  });
  return { body, footer, close };
}

export function confirm(
  page: Page,
  label: string,
  message: string,
  action: () => Promise<void>,
) {
  const modal = dialog(page, label);
  modal.body.append(element("p", message));
  modal.footer.append(
    button("Cancel", modal.close),
    button(
      label,
      () => {
        modal.close();
        void page.run(action, "Saving…");
      },
      "primary",
    ),
  );
}
