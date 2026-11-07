import "server-only";
import { RESUME_KEYS, STANDARD_FIELDS } from "@/lib/profile-fields";

/** Google Gemini (free tier via an AI Studio key), called with plain fetch. */
export function geminiConfigured() { return Boolean(process.env.GEMINI_API_KEY); }

// The free tier's main Flash model is often overloaded (503); the Lite model usually still answers.
const FALLBACK_MODEL = "gemini-flash-lite-latest";
const BUSY = new Set([429, 500, 503, 504]);

async function generate(parts: unknown[], schema: unknown) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("AI is not configured. Set GEMINI_API_KEY.");
  const primary = process.env.GEMINI_MODEL || "gemini-flash-latest";
  // Primary, primary again after a short pause, then the Lite model. Only "busy" errors move on; a bad key or request fails at once.
  const attempts = [primary, primary, ...(primary === FALLBACK_MODEL ? [] : [FALLBACK_MODEL])];
  let lastError = "";
  for (const [i, model] of attempts.entries()) {
    if (i === 1) await new Promise((r) => setTimeout(r, 1500));
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(18_000), // 3 tries x 18s + pause stays inside the route's 60s limit
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: schema } })
    }).catch((error: unknown) => error instanceof Error && error.name === "TimeoutError" ? null : Promise.reject(error)); // a hung model counts as busy
    const data = await response?.json().catch(() => null);
    if (response?.ok) {
      const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
      try { return JSON.parse(text) as unknown; } catch { throw new Error("Gemini returned an unreadable answer."); }
    }
    lastError = response ? `${response.status}${data?.error?.status ? ` ${data.error.status}` : ""}` : "timed out";
    if (response && !BUSY.has(response.status)) break;
  }
  throw new Error(`Gemini request failed (${lastError}). Google's free AI is busy; try again in a minute.`);
}

export type DraftQuestion = { id: string; label: string; options?: string[] };

/**
 * Drafts answers to form questions the answer bank doesn't cover, as the candidate, from their profile.
 * Never invents facts: anything the profile doesn't support comes back empty for the user to answer.
 */
export async function draftAnswers(profileText: string, questions: DraftQuestion[], job: { company?: string; title?: string }) {
  if (!questions.length) return new Map<string, string>();
  const result = await generate([{ text: [
    "You are filling a job application form for the candidate below. Answer each question in the candidate's voice (first person).",
    "Rules:",
    "- Use only facts from the candidate profile. If the profile doesn't support an answer (numbers, dates, salary, visa, personal facts), return an empty string. Never invent.",
    "- If a question lists options, the answer must be exactly one of those options, or empty.",
    "- Short questions get short answers. Open questions (why this company, describe…) get 2-4 specific sentences tied to the role and company.",
    `Job: ${job.title || "unknown role"} at ${job.company || "unknown company"}.`,
    `Candidate profile:\n${profileText}`,
    `Questions (JSON): ${JSON.stringify(questions.map((q) => ({ id: q.id, question: q.label, ...(q.options?.length ? { options: q.options.slice(0, 50) } : {}) })))}`
  ].join("\n") }], {
    type: "ARRAY",
    items: { type: "OBJECT", properties: { id: { type: "STRING" }, answer: { type: "STRING" } }, required: ["id", "answer"] }
  });
  const answers = new Map<string, string>();
  for (const item of Array.isArray(result) ? result : []) {
    const { id, answer } = (item ?? {}) as { id?: unknown; answer?: unknown };
    const q = questions.find((x) => x.id === id);
    if (!q || typeof answer !== "string" || !answer.trim()) continue;
    // An option question must come back as one of its options, or it's dropped.
    if (q.options?.length && !q.options.includes(answer.trim())) continue;
    answers.set(q.id, answer.trim().slice(0, 4000));
  }
  return answers;
}

/** Reads a resume PDF and returns the standard resume fields (blank when the resume doesn't say). */
export async function extractProfile(pdf: Buffer): Promise<Record<string, string>> {
  const fields = STANDARD_FIELDS.filter((f) => f.fromResume);
  const result = await generate([
    { inline_data: { mime_type: "application/pdf", data: pdf.toString("base64") } },
    { text: [
      "Extract the candidate's details from this resume for filling job application forms.",
      "Use only what the resume states; use an empty string when something isn't there. Never guess.",
      "yearsExperience: total professional experience as a number, e.g. \"3.5\". skills: comma-separated.",
      "summary: 2-3 sentences in first person. Links: full URLs. degree: highest degree only.",
      `Fields: ${fields.map((f) => `${f.key} (${f.label})`).join(", ")}.`
    ].join("\n") }
  ], { type: "OBJECT", properties: Object.fromEntries(RESUME_KEYS.map((k) => [k, { type: "STRING" }])), required: RESUME_KEYS });
  const out: Record<string, string> = {};
  for (const k of RESUME_KEYS) {
    const v = (result as Record<string, unknown> | null)?.[k];
    if (typeof v === "string" || typeof v === "number") out[k] = String(v).slice(0, 2000);
  }
  return out;
}
