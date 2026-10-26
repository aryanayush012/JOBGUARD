import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { hasTrustedOrigin, jsonError } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403); const user = await getCurrentUser(); if (!user) return jsonError("Authentication required.", 401);
  const db = await getDb(); await db.collection("gmailConnections").deleteOne({ userId: new ObjectId(user.id) }); return NextResponse.json({ ok: true });
}
