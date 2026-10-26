import { NextResponse } from "next/server";
import { ObjectId, MongoServerError } from "mongodb";
import { z } from "zod";
import { createSession, hashPassword, normalizeEmail } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { hasTrustedOrigin, jsonError } from "@/lib/http";

export const runtime = "nodejs";

const schema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(12).max(128)
});

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403);

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return jsonError("Enter a valid email and a password of at least 12 characters.", 400);

  const email = normalizeEmail(parsed.data.email);
  const db = await getDb();
  const now = new Date();

  try {
    const result = await db.collection("users").insertOne({
      _id: new ObjectId(),
      email,
      normalizedEmail: email,
      passwordHash: await hashPassword(parsed.data.password),
      accountStatus: "ACTIVE",
      emailVerifiedAt: null,
      createdAt: now,
      updatedAt: now
    });

    await createSession(result.insertedId);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      return jsonError("An account with that email may already exist. Try logging in.", 409);
    }
    throw error;
  }
}
