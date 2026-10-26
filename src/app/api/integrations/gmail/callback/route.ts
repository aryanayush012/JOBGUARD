import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { encryptToken, exchangeCode } from "@/lib/integrations/google-gmail";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const base = process.env.APP_BASE_URL || "http://localhost:3000"; const url = new URL(request.url); const state = url.searchParams.get("state"); const code = url.searchParams.get("code");
  if (!state || !code || url.searchParams.has("error")) return NextResponse.redirect(new URL("/dashboard?gmail=cancelled", base));
  const db = await getDb(); const saved = await db.collection("oauthStates").findOneAndDelete({ state, provider: "google-gmail", expiresAt: { $gt: new Date() } });
  if (!saved) return NextResponse.redirect(new URL("/dashboard?gmail=invalid-state", base));
  try {
    const tokens = await exchangeCode(code); if (!tokens.refresh_token) throw new Error("Google did not return a refresh token. Revoke the app in Google Account permissions and reconnect.");
    const access = tokens.access_token;
    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { authorization: `Bearer ${access}` }, cache: "no-store" });
    if (!profileResponse.ok) throw new Error("Could not read Google account profile."); const profile = await profileResponse.json();
    await db.collection("gmailConnections").updateOne({ userId: saved.userId as ObjectId }, { $set: { userId: saved.userId, provider: "google-gmail", email: String(profile.email || ""), encryptedRefreshToken: encryptToken(tokens.refresh_token), scopes: tokens.scope, connectedAt: new Date(), lastSyncedAt: null, status: "CONNECTED" } }, { upsert: true });
    return NextResponse.redirect(new URL("/dashboard?gmail=connected", base));
  } catch { return NextResponse.redirect(new URL("/dashboard?gmail=connection-failed", base)); }
}
