/** Small sign-in pages using the same typography, spacing and primary color as the Kora theme. */
export const signInPagePolicy =
  "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const style = `:root{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#252525;background:#fafafa;font-synthesis:none}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}main{width:100%;max-width:400px;background:white;border:1px solid #e5e5e5;border-radius:12px;padding:28px;box-shadow:0 1px 3px #00000008}h1{font-size:20px;line-height:1.4;font-weight:600;margin:0 0 24px}label{display:block;font-size:14px;font-weight:500}input{font:inherit;width:100%;height:40px;margin-top:8px;padding:8px 12px;border:1px solid #d4d4d4;border-radius:6px;background:white}input:focus-visible,button:focus-visible,a:focus-visible{outline:2px solid #63769c;outline-offset:3px}p{color:#737373;font-size:14px;line-height:1.5;margin:12px 0 20px}button{width:100%;height:40px;border:0;border-radius:6px;background:#1d2b4a;color:white;font:inherit;font-size:14px;font-weight:500;cursor:pointer}button:hover{background:#273858}a{color:#364e7a}`;
const head = `<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ClawScarf</title><style>${style}</style></head>`;
export function localSignInPage(returnTo: string) {
  return `<!doctype html>${head}<body><main><h1>ClawScarf</h1><form method="post" action="/_clawscarf/local?returnTo=${encodeURIComponent(returnTo)}"><label for="code">Sign-in code</label><input id="code" name="token" type="password" required autocomplete="off" autofocus><p>Enter the one-use code from your terminal.</p><button type="submit">Continue</button></form></main></body></html>`;
}
export function signedOutPage() {
  return `<!doctype html>${head}<body><main><h1>Signed out</h1><a href="/_clawscarf/login">Sign in</a></main></body></html>`;
}

/** Only fixed copy and local links reach the page; provider/query details stay out. */
export function signInFailurePage(code: string, local: boolean) {
  const title = code === "forbidden" ? "Access unavailable" : "Sign-in failed";
  const detail =
    code === "forbidden"
      ? "Ask your administrator for access, or sign in with a different account."
      : code === "email_unverified"
        ? "Verify your email address with your sign-in provider, then try again."
        : code === "invalid_authorization"
          ? local
            ? "This code is invalid, expired or already used. Get a new code from your terminal."
            : "This sign-in could not be completed. Start a new sign-in to try again."
          : code === "csrf_failed"
            ? "Open the sign-in page on this server and try again."
            : code === "rate_limited"
              ? "Too many sign-in attempts. Wait a moment before trying again."
              : code === "invalid_request"
                ? "This sign-in request is invalid. Start again from the sign-in page."
                : "Sign-in is temporarily unavailable. Try again later.";
  const href = local ? "/_clawscarf/local-sign-in" : "/_clawscarf/login";
  return `<!doctype html>${head}<body><main><h1>${title}</h1><p>${detail}</p><a href="${href}">Back to sign in</a></main></body></html>`;
}
