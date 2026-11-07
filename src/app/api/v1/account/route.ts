import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getCurrentUser, revokeCurrentSession } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { hasTrustedOrigin, jsonError } from "@/lib/http";
import { decryptToken } from "@/lib/integrations/google-gmail";

export const runtime = "nodejs";

/** Deletes your account and everything stored for it. Gmail access is revoked at Google too. Can't be undone. */
export async function DELETE(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403);
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  const db = await getDb(); const userId = new ObjectId(user.id);

  const connection = await db.collection("gmailConnections").findOne({ userId });
  if (connection?.encryptedRefreshToken) {
    // Best effort: if Google is unreachable the local token is still deleted below.
    try { await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: decryptToken(String(connection.encryptedRefreshToken)) }), signal: AbortSignal.timeout(8000) }); } catch {}
  }
  await revokeCurrentSession();
  await Promise.all(["jobs", "gmailEvents", "gmailConnections", "availabilityChecks", "jobReferrers", "referralContacts", "referralEvents", "profiles", "apiTokens", "sessions", "oauthStates"]
    .map((name) => db.collection(name).deleteMany({ userId })));
  await db.collection("users").deleteOne({ _id: userId });
  return NextResponse.json({ ok: true });
}
