import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getUserFromBearer } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { jsonError } from "@/lib/http";
import { getSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Which account the extension is connected to, plus the settings you chose on the Profile page. */
export async function GET(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) return jsonError("Token invalid or disconnected. Reconnect from your JobGuard Profile page.", 401);
  return NextResponse.json({ email: user.email, settings: await getSettings(await getDb(), new ObjectId(user.id)) });
}
