import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { safeNextPath } from "@/lib/http";
import { OAUTH_STATE_COOKIE, googleConfig, makeGoogleAuthUrl } from "@/lib/integrations/google-gmail";
export const runtime = "nodejs";
/**
 * Starts Google OAuth. Logged out: "Continue with Google" sign-in/sign-up, asking only for your email.
 * Logged in: the optional Gmail beta (read-only access, limited to test users while Google's review is pending).
 */
export async function GET(request: Request) {
  const base = process.env.APP_BASE_URL || "http://localhost:3000";
  try { googleConfig(); } catch { return NextResponse.redirect(new URL("/login?google=not-configured", base)); }
  const user = await getCurrentUser();
  const next = safeNextPath(new URL(request.url).searchParams.get("next"));
  const state = randomBytes(32).toString("base64url"); const db = await getDb(); const now = new Date();
  await db.collection("oauthStates").insertOne({ state, userId: user ? new ObjectId(user.id) : null, purpose: user ? "connect" : "login", next, provider: "google-gmail", createdAt: now, expiresAt: new Date(now.getTime() + 10 * 60_000) });
  const response = NextResponse.redirect(makeGoogleAuthUrl(state, { gmail: Boolean(user) }));
  // Ties the flow to this browser: a callback link opened anywhere else is rejected (blocks login CSRF).
  response.cookies.set(OAUTH_STATE_COOKIE, state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/integrations/gmail", maxAge: 600 });
  return response;
}
