import "server-only";

import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { hash, verify } from "@node-rs/argon2";
import { ObjectId } from "mongodb";
import { getDb } from "@/lib/mongodb";
import { getEnv } from "@/lib/env";

const COOKIE_NAME = "jpap_session";
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 14;

function hashSessionToken(value: string) {
  return createHmac("sha256", getEnv().SESSION_SECRET).update(value).digest("hex");
}

export async function hashPassword(password: string) {
  return hash(password, {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1
  });
}

export async function verifyPassword(passwordHash: string, password: string) {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export async function createSession(userId: ObjectId) {
  const rawToken = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS);
  const db = await getDb();

  await db.collection("sessions").insertOne({
    userId,
    tokenHash,
    createdAt: now,
    expiresAt,
    revokedAt: null,
    lastSeenAt: now
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt
  });
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(COOKIE_NAME)?.value;
  if (!rawToken) return null;

  const db = await getDb();
  const session = await db.collection("sessions").findOne({
    tokenHash: hashSessionToken(rawToken),
    revokedAt: null,
    expiresAt: { $gt: new Date() }
  });

  if (!session) return null;

  const user = await db.collection("users").findOne(
    { _id: session.userId, accountStatus: "ACTIVE" },
    { projection: { email: 1, createdAt: 1 } }
  );

  if (!user) return null;

  return {
    id: user._id.toString(),
    email: String(user.email)
  };
}

export async function revokeCurrentSession() {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(COOKIE_NAME)?.value;

  if (rawToken) {
    const db = await getDb();
    await db.collection("sessions").updateOne(
      { tokenHash: hashSessionToken(rawToken), revokedAt: null },
      { $set: { revokedAt: new Date() } }
    );
  }

  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0)
  });
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function getSessionDurationMs() {
  return SESSION_DURATION_MS;
}
