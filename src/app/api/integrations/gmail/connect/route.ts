import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { googleConfig, makeGoogleAuthUrl } from "@/lib/integrations/google-gmail";
export const runtime = "nodejs";
export async function GET() {
  const user = await getCurrentUser(); if (!user) return NextResponse.redirect(new URL("/login", process.env.APP_BASE_URL || "http://localhost:3000"));
  try { googleConfig(); } catch { return NextResponse.redirect(new URL("/dashboard?gmail=not-configured", process.env.APP_BASE_URL || "http://localhost:3000")); }
  const state = randomBytes(32).toString("base64url"); const db = await getDb(); const now = new Date();
  await db.collection("oauthStates").insertOne({ state, userId: new ObjectId(user.id), provider: "google-gmail", createdAt: now, expiresAt: new Date(now.getTime() + 10 * 60_000) });
  await db.collection("oauthStates").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  return NextResponse.redirect(makeGoogleAuthUrl(state));
}
