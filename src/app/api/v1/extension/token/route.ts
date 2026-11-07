import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { createExtensionToken, getCurrentUser, revokeExtensionTokens } from "@/lib/auth";
import { hasTrustedOrigin, jsonError } from "@/lib/http";

export const runtime = "nodejs";

/** Creates a new extension token (replacing any old one). The raw token is returned once and never stored. */
export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403);
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  return NextResponse.json({ token: await createExtensionToken(new ObjectId(user.id)) });
}

/** Disconnects the extension. */
export async function DELETE(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403);
  const user = await getCurrentUser();
  if (!user) return jsonError("Authentication required.", 401);
  await revokeExtensionTokens(new ObjectId(user.id));
  return NextResponse.json({ ok: true });
}
