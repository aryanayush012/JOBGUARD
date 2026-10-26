import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Reject cross-origin state-changing browser requests.
 * This is defense in depth, not a replacement for authentication or validation.
 */
/**
 * Post-login redirect target. Only same-site paths are allowed, so `?next=`
 * can't become an open redirect (e.g. "//evil.com" or "/\evil.com").
 */
export function safeNextPath(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/")) return "/dashboard";
  try {
    const url = new URL(value, "http://local.invalid");
    return url.origin === "http://local.invalid" ? url.pathname + url.search : "/dashboard";
  } catch {
    return "/dashboard";
  }
}

export function hasTrustedOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).origin === new URL(getEnv().APP_BASE_URL).origin;
  } catch {
    return false;
  }
}
