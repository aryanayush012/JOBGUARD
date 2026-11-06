import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { hasTrustedOrigin, jsonError } from "@/lib/http";
import { loadProfile, saveFields } from "@/lib/profile";
import { isCompanySpecific } from "@/lib/profile-fields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const upsertSchema = z.object({
  key: z.string().trim().max(80).optional(),          // omit to add a new saved answer
  label: z.string().trim().min(1).max(300),
  value: z.string().max(5000)
});

/** Edit a field or add/update a saved answer. Anything you set is marked as yours, so a resume re-upload never overwrites it. */
export async function PUT(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403);
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  const parsed = upsertSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Enter a question (up to 300 characters) and an answer (up to 5000).", 400);

  const db = await getDb(); const userId = new ObjectId(user.id);
  const { fields } = await loadProfile(db, userId);
  const { key, label, value } = parsed.data; const now = new Date().toISOString();
  const existing = key ? fields.find((f) => f.key === key) : undefined;
  if (key && !existing) return jsonError("Field not found.", 404);
  const custom = !existing || existing.group === "Saved answers";
  const updated = existing
    ? fields.map((f) => f.key === key ? { ...f, value: value.trim(), source: "USER" as const, updatedAt: now, ...(custom ? { label, reusable: !isCompanySpecific(label) } : {}) } : f)
    : [...fields, { key: `q-${randomBytes(6).toString("hex")}`, label, group: "Saved answers" as const, aliases: [], value: value.trim(), source: "USER" as const, fromResume: false, reusable: !isCompanySpecific(label), updatedAt: now }];
  await saveFields(db, userId, updated);
  return NextResponse.json(await loadProfile(db, userId));
}

/** Delete a saved answer (standard fields are cleared by saving an empty value instead). */
export async function DELETE(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403);
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  const key = new URL(request.url).searchParams.get("key");
  const db = await getDb(); const userId = new ObjectId(user.id);
  const { fields } = await loadProfile(db, userId);
  if (!fields.some((f) => f.key === key && f.group === "Saved answers")) return jsonError("Saved answer not found.", 404);
  await saveFields(db, userId, fields.filter((f) => f.key !== key));
  return NextResponse.json(await loadProfile(db, userId));
}
