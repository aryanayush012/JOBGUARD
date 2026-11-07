import { NextResponse } from "next/server";
import { getUserFromBearer } from "@/lib/auth";
import { jsonError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Extension "Test connection": which account this token belongs to. */
export async function GET(request: Request) {
  const user = await getUserFromBearer(request);
  if (!user) return jsonError("Token invalid or disconnected. Create a new one on your JobGuard Profile page.", 401);
  return NextResponse.json({ email: user.email });
}
