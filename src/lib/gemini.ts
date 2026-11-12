import "server-only";
import { RESUME_KEYS, STANDARD_FIELDS } from "@/lib/profile-fields";

/** Google Gemini (free tier via an AI Studio key), called with plain fetch. */
export function geminiConfigured() { return Boolean(process.env.GEMINI_API_KEY); }

// Every free Gemini model has its own capacity: when one is overloaded (503) others usually still answer.
// So instead of retrying one model, try several in turn, fast "lite" models first.
const API = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest"];
const AUTH_FAILED = new Set([401, 403]); // a bad key won't get better on another model
let modelCache: { at: number; models: string[] } | null = null;
let lastGood = ""; // the model that answered last; tried first next time (per server instance)

/** Gemini Flash models this key can use, from Google's own list (refreshed every 6 hours) so renames don't break us. */
async function availableModels(apiKey: string) {
  if (modelCache && Date.now() - modelCache.at < 6 * 60 * 60 * 1000) return modelCache.models;
  try {
    const response = await fetch(`${API}?pageSize=200`, { headers: { "x-goog-api-key": apiKey }, cache: "no-store", signal: AbortSignal.timeout(5000) });
    const data = await response.json() as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
    const names = (data.models ?? []).filter((m) => m.supportedGenerationMethods?.includes("generateContent")).map((m) => m.name.replace(/^models\//, ""))
      .filter((n) => /^gemini-(flash(-lite)?-latest|\d+(\.\d+)?-flash(-lite)?)$/.test(n)); // stable Flash models only, no previews
    const version = (n: string) => Number(/(\d+(\.\d+)?)/.exec(n)?.[1] ?? 99); // "-latest" aliases sort first
    const ordered = names.sort((a, b) => Number(b.includes("lite")) - Number(a.includes("lite")) || version(b) - version(a));
    modelCache = { at: Date.now(), models: ordered.length ? ordered : DEFAULT_MODELS };
  } catch { modelCache = { at: Date.now() - 5.5 * 60 * 60 * 1000, models: DEFAULT_MODELS }; } // retry the list in 30 min
  return modelCache.models;
}

async function generate(parts: unknown[], schema: unknown, budgetMs = 50_000) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("AI is not configured. Set GEMINI_API_KEY.");
  const start = Date.now();
  const models = [...new Set([process.env.GEMINI_MODEL, lastGood, ...(await availableModels(apiKey))].filter((m): m is string => Boolean(m)))];
  let lastError = "";
  for (const model of models) {
    const left = budgetMs - (Date.now() - start);
    if (left < 3000) break; // stay inside the route's time limit
    const response = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(Math.min(15_000, left)),
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { temperature: 0.2, responseMimeType: "application/json", responseSchema: schema } })
    }).catch((error: unknown) => error instanceof Error && error.name === "TimeoutError" ? null : Promise.reject(error)); // a hung model counts as busy
    const data = await response?.json().catch(() => null);
    if (response?.ok) {
      const text = data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
      try { const parsed = JSON.parse(text) as unknown; lastGood = model; return parsed; } catch { lastError = "unreadable answer"; continue; }
    }
    lastError = response ? `${response.status}${data?.error?.status ? ` ${data.error.status}` : ""}` : "timed out";
    if (response && AUTH_FAILED.has(response.status)) throw new Error("Gemini rejected the API key. Check GEMINI_API_KEY.");
    if (lastGood === model) lastGood = ""; // it's struggling now; don't lead with it next time
  }
  throw new Error(`Google's free AI is busy right now (${models.length} models tried, last: ${lastError}). Try again in a minute.`);
}

export type DraftQuestion = { id: string; label: string; options?: string[] };

/**
 * Drafts answers to form questions the answer bank doesn't cover, as the candidate, from their profile.
 * Never invents facts: anything the profile doesn't support comes back empty for the user to answer.
 */
export async function draftAnswers(profileText: string, questions: DraftQuestion[], job: { company?: string; title?: string }) {
  if (!questions.length) return new Map<string, string>();
  questions = questions.slice(0, 20); // ponytail: one request per page; the rest stay for you (very long forms are rare)
  const result = await generate([{ text: [
    "You are filling a job application form for the candidate below. Answer each question in the candidate's voice (first person).",
    "Rules:",
    "- Factual questions (numbers, dates, salary, notice period, visa, location, personal details): use only the profile. If it doesn't say, return an empty string. Never invent facts.",
    "- Open questions (why this company or role, about yourself, motivation, strengths): always answer, in 2-4 specific sentences that connect the candidate's real experience and skills to this role and company. Don't claim facts the profile doesn't support.",
    "- If a question lists options, the answer must be exactly one of those options, or empty.",
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
