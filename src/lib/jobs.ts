import { z } from "zod";

export const jobInputSchema = z.object({
  sourceUrl: z.string().trim().url().max(2048),
  applicationUrl: z.string().trim().url().max(2048).optional().or(z.literal("")),
  company: z.string().trim().max(160).optional().default(""),
  title: z.string().trim().max(200).optional().default(""),
  location: z.string().trim().max(160).optional().default(""),
  description: z.string().trim().max(20000).optional().default(""),
  deadlineAt: z.string().trim().optional().or(z.literal("")),
  applied: z.boolean().optional().default(false),
  referred: z.boolean().optional().default(false),
  referredBy: z.string().trim().max(120).optional().default("")
}).superRefine((value, ctx) => {
  for (const key of ["sourceUrl", "applicationUrl"] as const) {
    const raw = value[key];
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (!["http:", "https:"].includes(url.protocol)) throw new Error();
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: "Enter a valid HTTP or HTTPS URL." });
    }
  }
});

const APPLIED_EMAIL_STATUSES = ["SUBMITTED", "INTERVIEW", "REJECTED"];

/** Jobs saved before the `applied` field existed fall back to what Gmail detected. */
export function isApplied(job: Record<string, unknown>) {
  return typeof job.applied === "boolean" ? job.applied : APPLIED_EMAIL_STATUSES.includes(String(job.emailDetectedApplicationStatus));
}

export type JobTab = "not-applied" | "referred" | "applied";
export function jobTab(job: Record<string, unknown>): JobTab {
  return isApplied(job) ? "applied" : job.referred ? "referred" : "not-applied";
}

function decodeEntities(value: string) {
  return value
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

// Hosted job boards put the company slug in the URL: greenhouse/lever/ashby paths, workday subdomains.
function companyFromBoardUrl(pageUrl: string) {
  try {
    const url = new URL(pageUrl);
    const host = url.hostname.toLowerCase();
    const first = url.pathname.split("/").filter(Boolean)[0] ?? "";
    let slug = "";
    if (/(^|\.)greenhouse\.io$|^jobs\.lever\.co$|^jobs\.ashbyhq\.com$/.test(host)) slug = first;
    else if (host.endsWith(".myworkdayjobs.com")) slug = host.split(".")[0];
    return slug && slug !== "embed" ? decodeURIComponent(slug).replace(/[-_]+/g, " ").trim() : "";
  } catch {
    return "";
  }
}

/**
 * Best-effort company/title from a job page. Reads schema.org JobPosting JSON-LD
 * (what Google Jobs indexes), then falls back to the job-board URL for the company.
 * Returns "" for anything not found — never guesses from page titles.
 */
export function extractJobDetails(html: string, pageUrl: string) {
  let company = "";
  let title = "";
  forEachJobPosting(html, (record) => {
    if (!title && typeof record.title === "string") title = decodeEntities(record.title);
    const org = record.hiringOrganization;
    const name = typeof org === "string" ? org : (org as Record<string, unknown> | undefined)?.name;
    if (!company && typeof name === "string") company = decodeEntities(name);
  });
  return { company: (company || companyFromBoardUrl(pageUrl)).slice(0, 160), title: title.slice(0, 200) };
}

/** Calls `fn` for every schema.org JobPosting in the page's JSON-LD, including ones inside @graph. */
function forEachJobPosting(html: string, fn: (record: Record<string, unknown>) => void) {
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    if (([] as unknown[]).concat(record["@type"]).includes("JobPosting")) fn(record);
    if (record["@graph"]) visit(record["@graph"]);
  };
  for (const match of html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(match[1].trim())); } catch { /* malformed JSON-LD is common; skip it */ }
  }
}

const DAY = 24 * 60 * 60 * 1000;
/**
 * Deadline for a job the user gave none for: the posting's own `validThrough` is VERIFIED;
 * otherwise ESTIMATED as the earlier of today + 5 days and posted date + 30 days, so you apply early.
 */
export function estimateDeadline(html: string, now = new Date()) {
  let validThrough: Date | null = null;
  let datePosted: Date | null = null;
  const toDate = (value: unknown) => { const d = typeof value === "string" ? new Date(value) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
  forEachJobPosting(html, (record) => { validThrough ||= toDate(record.validThrough); datePosted ||= toDate(record.datePosted); });
  if (validThrough) return { deadlineAt: validThrough as Date, deadlineConfidence: "VERIFIED" as const };
  // ponytail: rule of thumb, most postings close within ~30 days; swap for real data if estimates prove off.
  const early = now.getTime() + 5 * DAY;
  const fromPosted = datePosted ? (datePosted as Date).getTime() + 30 * DAY : Infinity;
  return { deadlineAt: new Date(Math.min(early, fromPosted)), deadlineConfidence: "ESTIMATED" as const };
}

/** Open/closed verdict from a fetched job page's HTTP status and visible text. */
export function assessAvailability(httpStatus: number, text: string, html = "") {
  const t = text.toLowerCase();
  if ([404, 410].includes(httpStatus)) return { availabilityStatus: "CLOSED", confidence: "MEDIUM", evidence: `HTTP ${httpStatus}` };
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429 || httpStatus >= 500) return { availabilityStatus: "UNVERIFIED", confidence: "LOW", evidence: `HTTP ${httpStatus}; access blocked or server error` };
  if (/job (posting )?(is )?(no longer available|has expired|is closed)|position has been filled|this job is no longer available|applications (are|have been) closed|job has been taken down|this role is no longer accepting applications/.test(t)) return { availabilityStatus: "CLOSED", confidence: "HIGH", evidence: "Page contains explicit closure wording" };
  if (/apply now|submit application|apply for this job|easy apply/.test(t) && !/no longer available|applications closed|position filled/.test(t) && httpStatus >= 200 && httpStatus < 300) return { availabilityStatus: "OPEN", confidence: "MEDIUM", evidence: "Page contains an application action" };
  // JS-rendered boards (Workday etc.) have no visible text, but still publish JobPosting data while the job is live.
  let hasPosting = false;
  forEachJobPosting(html, () => { hasPosting = true; });
  if (hasPosting && httpStatus >= 200 && httpStatus < 300) return { availabilityStatus: "OPEN", confidence: "MEDIUM", evidence: "Page publishes live job posting data" };
  return { availabilityStatus: "UNKNOWN", confidence: "LOW", evidence: `HTTP ${httpStatus}; no reliable availability signal found` };
}

export function normalizeJobUrl(value: string) {
  const url = new URL(value.trim());
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_.+|trk|trackingid|ref|source)$/i.test(key)) url.searchParams.delete(key);
  }
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  url.searchParams.sort();
  return url.toString();
}
