#!/usr/bin/env node
/**
 * One-time Google consent for Akira. Run on Amos's Mac:
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run google-auth
 * Opens a consent URL; after approval prints GOOGLE_REFRESH_TOKEN to store as a GitHub Actions secret.
 * Scopes: Gmail read-only, Calendar events. Nothing else.
 *
 * Inbox-cleanup account (e.g. cosbymonica@gmail.com): `npm run google-auth -- --mail`, sign in AS that account.
 * Requests full mail access (IMAP/SMTP) and prints CLEANUP_GOOGLE_REFRESH_TOKEN instead.
 */
import http from "node:http";
import { GOOGLE_MAIL_SCOPES, GOOGLE_SCOPES } from "./integrations/google.js";

const mail = process.argv.includes("--mail");
const scopes = mail ? GOOGLE_MAIL_SCOPES : GOOGLE_SCOPES;
const tokenName = mail ? "CLEANUP_GOOGLE_REFRESH_TOKEN" : "GOOGLE_REFRESH_TOKEN";

const id = process.env.GOOGLE_CLIENT_ID;
const secret = process.env.GOOGLE_CLIENT_SECRET;
if (!id || !secret) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (Google Cloud Console → Credentials → OAuth client, type Desktop app).");
  process.exit(1);
}
const port = 8765;
const redirect = `http://127.0.0.1:${port}/callback`;
const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
url.search = new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: "code", access_type: "offline", prompt: "consent", scope: scopes.join(" ") }).toString();

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", redirect);
  if (u.pathname !== "/callback") return void res.end("waiting");
  const code = u.searchParams.get("code");
  if (!code) return void res.end("no code");
  const body = new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: "authorization_code" });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  const j = (await r.json()) as { refresh_token?: string; error?: string };
  if (!j.refresh_token) {
    res.end("Failed: " + JSON.stringify(j));
    console.error(j);
    process.exit(1);
  }
  res.end("Akira is connected. You can close this tab.");
  console.log(`\n${tokenName}=` + j.refresh_token + "\n\nAdd it (with GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET) as GitHub Actions secrets.");
  server.close();
});
server.listen(port, "127.0.0.1", () => {
  console.log("Open this URL in your browser and approve:\n\n" + url.toString() + "\n");
});
