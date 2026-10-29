import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly", "openid", "email"];
export function googleConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const baseUrl = process.env.APP_BASE_URL;
  const key = process.env.GMAIL_TOKEN_ENCRYPTION_KEY;
  if (!clientId || !clientSecret || !baseUrl || !key) throw new Error("Gmail integration is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GMAIL_TOKEN_ENCRYPTION_KEY.");
  const encryptionKey = Buffer.from(key, "base64");
  if (encryptionKey.length !== 32) throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return { clientId, clientSecret, baseUrl: baseUrl.replace(/\/$/, ""), encryptionKey };
}
export function gmailScopes() { return SCOPES; }
export function encryptToken(token: string) {
  const { encryptionKey } = googleConfig(); const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return [iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}
export function decryptToken(value: string) {
  const { encryptionKey } = googleConfig(); const [iv, tag, encrypted] = value.split(".");
  if (!iv || !tag || !encrypted) throw new Error("Stored Gmail token is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}
export function makeGoogleAuthUrl(state: string) {
  const { clientId, baseUrl } = googleConfig(); const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId); url.searchParams.set("redirect_uri", `${baseUrl}/api/integrations/gmail/callback`);
  url.searchParams.set("response_type", "code"); url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline"); url.searchParams.set("prompt", "consent"); url.searchParams.set("include_granted_scopes", "true"); url.searchParams.set("state", state);
  return url.toString();
}
export async function exchangeCode(code: string) {
  const { clientId, clientSecret, baseUrl } = googleConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: `${baseUrl}/api/integrations/gmail/callback`, grant_type: "authorization_code" }), cache: "no-store" });
  const data = await response.json(); if (!response.ok) throw new Error("Google token exchange failed."); return data as { access_token: string; refresh_token?: string; expires_in: number; scope: string; token_type: string };
}
export async function getAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = googleConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }), cache: "no-store" });
  const data = await response.json(); if (!response.ok || !data.access_token) throw new Error("Could not refresh Gmail access. Please reconnect Gmail."); return String(data.access_token);
}
export async function gmailApi<T>(accessToken: string, path: string, attempt = 0): Promise<T> {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (response.ok) return response.json() as Promise<T>;
  const body = await response.json().catch(() => null);
  const reason = String(body?.error?.errors?.[0]?.reason || body?.error?.status || "");
  // Rate limits come back as 429 or 403 *RateLimitExceeded; back off and retry (1s, 2s, 4s).
  if ((response.status === 429 || /ratelimit/i.test(reason)) && attempt < 3) {
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    return gmailApi<T>(accessToken, path, attempt + 1);
  }
  throw new Error(`Gmail API request failed (${response.status}${reason ? ` ${reason}` : ""}).`);
}