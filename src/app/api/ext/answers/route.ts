import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getUserFromBearer } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { jsonError } from "@/lib/http";
import { loadProfile, saveFields } from "@/lib/profile";
import { isCompanySpecific, isSensitive, normalizeLabel } from "@/lib/profile-fields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  company: z.string().max(160).optional(),
  answers: z.array(z.object({ label: z.string().trim().min(1).max(300), value: z.string().trim().min(1).max(5000) })).min(1).max(50)
});

/** Saves answers you approved in the extension to your answer bank, so the next form fills them automatically. */
export async function POST(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) return jsonError("Token invalid or disconnected.", 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid answers.", 400);
  const db = await getDb(); const userId = new ObjectId(user.id);
  const { fields } = await loadProfile(db, userId); const now = new Date().toISOString();
  let saved = 0;
  for (const { label, value } of parsed.data.answers) {
    if (isSensitive(label)) continue; // never stored: you answer these yourself each time
    const reusable = !isCompanySpecific(label, parsed.data.company);
    const existing = fields.find((f) => f.group === "Saved answers" && normalizeLabel(f.label) === normalizeLabel(label));
    if (existing) Object.assign(existing, { value, source: "USER", reusable, updatedAt: now });
    else fields.push({ key: `q-${randomBytes(6).toString("hex")}`, label, group: "Saved answers", aliases: [], value, source: "USER", fromResume: false, reusable, updatedAt: now });
    saved++;
  }
  await saveFields(db, userId, fields);
  return NextResponse.json({ saved });
}
