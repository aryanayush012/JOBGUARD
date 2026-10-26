import { NextResponse } from "next/server";
import { revokeCurrentSession } from "@/lib/auth";
import { hasTrustedOrigin, jsonError } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!hasTrustedOrigin(request)) return jsonError("Invalid request origin.", 403);
  await revokeCurrentSession();
  return NextResponse.json({ ok: true });
}
