import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { jsonError } from "@/lib/http";
import { loadProfile } from "@/lib/profile";
import { geminiConfigured } from "@/lib/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  const profile = await loadProfile(await getDb(), new ObjectId(user.id));
  return NextResponse.json({ ...profile, aiEnabled: geminiConfigured() });
}
