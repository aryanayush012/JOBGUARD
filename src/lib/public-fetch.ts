import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

function privateIPv4(ip: string) { const p = ip.split(".").map(Number); return p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255) || p[0] === 10 || p[0] === 127 || p[0] === 0 || p[0] >= 224 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127); }
function privateIPv6(ip: string) { const v = ip.toLowerCase(); return v === "::1" || v === "::" || v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("ff") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168."); }
async function safePublicUrl(raw: string) {
  const url = new URL(raw); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error("Only public HTTP(S) job URLs are allowed.");
  const host = url.hostname.toLowerCase(); if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Private network destinations are blocked.");
  if (isIP(host)) { if ((isIP(host) === 4 && privateIPv4(host)) || (isIP(host) === 6 && privateIPv6(host))) throw new Error("Private network destinations are blocked."); }
  else { const addresses = await lookup(host, { all: true, verbatim: true }); if (!addresses.length || addresses.some((a) => (isIP(a.address) === 4 && privateIPv4(a.address)) || (isIP(a.address) === 6 && privateIPv6(a.address)))) throw new Error("The job URL does not resolve exclusively to public addresses."); }
  return url;
}

/** Bounded, SSRF-guarded GET of a public page. `html` is raw markup; `text` is visible text only. */
export async function fetchPublicPage(initialUrl: string) {
  let current = initialUrl;
  for (let i = 0; i < 5; i++) {
    const url = await safePublicUrl(current);
    const response = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8000), headers: { "user-agent": "JobGuardAvailabilityChecker/1.0 (+checks public job posting status)", accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" }, cache: "no-store" });
    if ([301, 302, 303, 307, 308].includes(response.status)) { const location = response.headers.get("location"); if (!location) return { status: response.status, html: "", text: "Redirect without location" }; current = new URL(location, url).toString(); continue; }
    const type = response.headers.get("content-type") || ""; if (!type.includes("text/html") && !type.includes("text/plain") && !type.includes("application/xhtml+xml")) return { status: response.status, html: "", text: `Non-HTML response: ${type}` };
    const reader = response.body?.getReader(); let bytes = 0; let html = "";
    if (reader) { const decoder = new TextDecoder(); while (bytes < 800_000) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; html += decoder.decode(chunk.value, { stream: true }); } try { await reader.cancel(); } catch {} }
    const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").slice(0, 100000);
    return { status: response.status, html, text };
  }
  throw new Error("Too many redirects while checking the job page.");
}
