import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { hasTrustedOrigin, jsonError } from "@/lib/http";
import { updateSettings } from "@/lib/settings";

export const runtime = "nodejs";

const schema = z.object({ autoFill: z.boolean().optional(), emailScan: z.boolean().optional(), aiAssist: z.boolean().optional() }).strict();

/** Change a privacy/automation setting (each toggle on the Profile page saves itself). */
export async function PUT(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403);
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid setting.", 400);
  return NextResponse.json({ settings: await updateSettings(await getDb(), new ObjectId(user.id), parsed.data) });
}
