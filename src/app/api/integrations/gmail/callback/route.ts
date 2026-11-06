import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ObjectId, type Db } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { createSession, getCurrentUser, normalizeEmail } from "@/lib/auth";
import { OAUTH_STATE_COOKIE, encryptToken, exchangeCode, grantedGmailRead } from "@/lib/integrations/google-gmail";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const base = process.env.APP_BASE_URL || "http://localhost:3000"; const url = new URL(request.url); const state = url.searchParams.get("state"); const code = url.searchParams.get("code");
  const user = await getCurrentUser();
  const fail = (reason: string) => redirect(base, user ? `/dashboard?gmail=${reason}` : `/login?google=${reason}`);
  if (!state || !code || url.searchParams.has("error")) return fail("cancelled");
  // The state must come back to the same browser that started the flow (cookie set by /connect).
  if ((await cookies()).get(OAUTH_STATE_COOKIE)?.value !== state) return fail("invalid-state");
  const db = await getDb(); const saved = await db.collection("oauthStates").findOneAndDelete({ state, provider: "google-gmail", expiresAt: { $gt: new Date() } });
  if (!saved) return fail("invalid-state");
  // Connecting Gmail: the logged-in user must be the one who started it, so a shared consent
  // link can't attach someone else's inbox to the link creator's account.
  if (saved.purpose !== "login" && (!user || user.id !== String(saved.userId))) return fail("invalid-state");
  try {
    const tokens = await exchangeCode(code);
    const profileResponse = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { authorization: `Bearer ${tokens.access_token}` }, cache: "no-store" });
    if (!profileResponse.ok) throw new Error("Could not read Google account profile.");
    const profile = await profileResponse.json() as { email?: string; verified_email?: boolean };
    const gmailEmail = String(profile.email || "");

    if (saved.purpose === "login") {
      // Google has verified the address, so it is safe to sign in to (or create) the account that owns it.
      if (!profile.verified_email || !gmailEmail) return fail("unverified-email");
      const userId = await findOrCreateGoogleUser(db, gmailEmail);
      if (!userId) return fail("account-disabled");
      if (tokens.refresh_token && grantedGmailRead(tokens.scope)) await saveConnection(db, userId, gmailEmail, tokens.refresh_token, tokens.scope);
      await createSession(userId);
      return redirect(base, typeof saved.next === "string" ? saved.next : "/dashboard");
    }

    if (!tokens.refresh_token) throw new Error("Google did not return a refresh token.");
    if (!grantedGmailRead(tokens.scope)) return fail("no-gmail-access");
    await saveConnection(db, saved.userId as ObjectId, gmailEmail, tokens.refresh_token, tokens.scope);
    return redirect(base, "/dashboard?gmail=connected");
  } catch { return fail("connection-failed"); }
}

function redirect(base: string, path: string) {
  const response = NextResponse.redirect(new URL(path, base));
  response.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/api/integrations/gmail", maxAge: 0 }); // one-time use
  return response;
}

/** Existing account with this email (password or Google), or a new Google-only one. Null if disabled. */
async function findOrCreateGoogleUser(db: Db, email: string) {
  const normalizedEmail = normalizeEmail(email); const now = new Date();
  // passwordHash null: password login always fails for Google-only accounts.
  const user = await db.collection("users").findOneAndUpdate(
    { normalizedEmail },
    { $setOnInsert: { _id: new ObjectId(), email: normalizedEmail, normalizedEmail, passwordHash: null, authProvider: "google", accountStatus: "ACTIVE", emailVerifiedAt: now, createdAt: now, updatedAt: now } },
    { upsert: true, returnDocument: "after" }
  );
  return user && user.accountStatus === "ACTIVE" ? user._id as ObjectId : null;
}

async function saveConnection(db: Db, userId: ObjectId, email: string, refreshToken: string, scopes: string) {
  await db.collection("gmailConnections").updateOne({ userId }, { $set: { userId, provider: "google-gmail", email, encryptedRefreshToken: encryptToken(refreshToken), scopes, connectedAt: new Date(), lastSyncedAt: null, lastSyncAttemptAt: null, status: "CONNECTED" } }, { upsert: true }); // null attempt = first dashboard load syncs
}
