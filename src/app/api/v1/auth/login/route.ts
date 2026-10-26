import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, normalizeEmail, verifyPassword } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { hasTrustedOrigin, jsonError } from "@/lib/http";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128)
});

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403);

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid email or password.", 400);

  const email = normalizeEmail(parsed.data.email);
  const db = await getDb();
  const user = await db.collection("users").findOne({ normalizedEmail: email });

  if (!user || user.accountStatus !== "ACTIVE" ||
      !(await verifyPassword(String(user.passwordHash), parsed.data.password))) {
    return jsonError("Invalid email or password.", 401);
  }

  await createSession(user._id);
  return NextResponse.json({ ok: true });
}
