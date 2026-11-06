/**
 * The answer bank: standard fields (filled from the resume or by you) plus your saved answers to
 * other questions. Pure functions only, so the matching and merge rules are testable.
 */
export const GROUPS = ["Personal", "Links", "Experience", "Education", "Preferences", "Saved answers"] as const;
export type Group = typeof GROUPS[number];
export type FieldSource = "RESUME" | "USER" | "AI";
export type ProfileField = {
  key: string; label: string; group: Group; aliases: string[]; value: string;
  source: FieldSource; fromResume: boolean; reusable: boolean; updatedAt: string | null;
};

type Def = { key: string; label: string; group: Group; aliases: string[]; fromResume: boolean };
// fromResume: false = a resume can't answer it (CTC, notice period, authorization); you fill it in once.
export const STANDARD_FIELDS: Def[] = [
  { key: "firstName", label: "First name", group: "Personal", fromResume: true, aliases: ["given name", "first"] },
  { key: "lastName", label: "Last name", group: "Personal", fromResume: true, aliases: ["surname", "family name", "last"] },
  { key: "fullName", label: "Full name", group: "Personal", fromResume: true, aliases: ["name", "legal name", "candidate name"] },
  { key: "email", label: "Email", group: "Personal", fromResume: true, aliases: ["email address", "e-mail", "email id"] },
  { key: "phone", label: "Phone", group: "Personal", fromResume: true, aliases: ["phone number", "mobile", "mobile number", "contact number", "telephone", "cell phone"] },
  { key: "location", label: "Current location", group: "Personal", fromResume: true, aliases: ["city", "location", "current city", "address", "where are you based"] },
  { key: "linkedin", label: "LinkedIn", group: "Links", fromResume: true, aliases: ["linkedin url", "linkedin profile"] },
  { key: "github", label: "GitHub", group: "Links", fromResume: true, aliases: ["github url", "github profile"] },
  { key: "portfolio", label: "Portfolio / website", group: "Links", fromResume: true, aliases: ["website", "personal website", "portfolio url", "blog"] },
  { key: "currentCompany", label: "Current company", group: "Experience", fromResume: true, aliases: ["current employer", "company name", "employer", "current organization"] },
  { key: "currentTitle", label: "Current job title", group: "Experience", fromResume: true, aliases: ["current title", "designation", "current role", "job title", "current position"] },
  { key: "yearsExperience", label: "Total years of experience", group: "Experience", fromResume: true, aliases: ["years of experience", "total experience", "experience in years", "how many years of experience"] },
  { key: "skills", label: "Skills", group: "Experience", fromResume: true, aliases: ["key skills", "technical skills", "skill set"] },
  { key: "summary", label: "Professional summary", group: "Experience", fromResume: true, aliases: ["summary", "about you", "tell us about yourself", "profile summary", "cover letter"] },
  { key: "degree", label: "Highest degree", group: "Education", fromResume: true, aliases: ["degree", "highest qualification", "education", "qualification"] },
  { key: "university", label: "University / college", group: "Education", fromResume: true, aliases: ["university", "college", "school", "institution"] },
  { key: "graduationYear", label: "Graduation year", group: "Education", fromResume: true, aliases: ["year of graduation", "graduation date", "passing year"] },
  { key: "noticePeriod", label: "Notice period", group: "Preferences", fromResume: false, aliases: ["notice period in days", "when can you start", "earliest start date", "availability to join", "joining time"] },
  { key: "currentCtc", label: "Current CTC", group: "Preferences", fromResume: false, aliases: ["current salary", "current compensation", "current ctc in lpa"] },
  { key: "expectedCtc", label: "Expected CTC", group: "Preferences", fromResume: false, aliases: ["expected salary", "salary expectation", "expected compensation", "desired salary"] },
  { key: "workAuthorization", label: "Work authorization", group: "Preferences", fromResume: false, aliases: ["are you legally authorized to work", "work permit", "visa status", "require sponsorship", "authorized to work"] },
  { key: "relocate", label: "Willing to relocate", group: "Preferences", fromResume: false, aliases: ["open to relocation", "willing to relocate", "relocation"] },
  { key: "preferredLocations", label: "Preferred locations", group: "Preferences", fromResume: false, aliases: ["preferred location", "preferred work location", "location preference"] }
];
export const RESUME_KEYS = STANDARD_FIELDS.filter((f) => f.fromResume).map((f) => f.key);

const FILLER = /\b(please|enter|provide|your|you|the|a|an|what is|what's|do|are|is|in|of)\b/g;
export function normalizeLabel(label: string) {
  return label.toLowerCase().replace(/\(optional\)|\*/g, " ").replace(/[^a-z0-9 ]+/g, " ").replace(FILLER, " ").replace(/\s+/g, " ").trim();
}

/** "Why do you want to join X?" style answers are drafted fresh for each company, never reused. */
export function isCompanySpecific(label: string, company = "") {
  const l = label.toLowerCase();
  return /why (do you want|are you interested|join|this (role|company|position|team)|us\b)|what (excites|interests|attracts) you|why (should we|do you think you)/.test(l)
    || (company.trim().length >= 3 && l.includes(company.trim().toLowerCase()));
}

/** Every standard field (empty if unknown) followed by your saved answers, in display order. */
export function withStandardFields(stored: ProfileField[]) {
  const byKey = new Map(stored.map((f) => [f.key, f]));
  const standard = STANDARD_FIELDS.map((d): ProfileField => {
    const s = byKey.get(d.key);
    return { ...d, value: s?.value ?? "", source: s?.source ?? "RESUME", reusable: true, updatedAt: s?.updatedAt ?? null };
  });
  return [...standard, ...stored.filter((f) => !STANDARD_FIELDS.some((d) => d.key === f.key))];
}

/** Re-uploading a resume refreshes resume-sourced values; anything you edited (USER) is never overwritten. */
export function mergeResume(stored: ProfileField[], extracted: Record<string, string>, now = new Date()) {
  return withStandardFields(stored).map((f) => {
    const value = (extracted[f.key] ?? "").trim();
    if (!f.fromResume || f.source === "USER" || !value) return f;
    return { ...f, value, source: "RESUME" as const, updatedAt: now.toISOString() };
  });
}

/** Finds the saved answer for a form question: exact label/alias, then the longest alias inside the question, then word overlap. */
export function matchField(question: string, fields: ProfileField[]) {
  const q = normalizeLabel(question);
  if (!q) return null;
  const candidates = fields.filter((f) => f.value && f.reusable);
  const names = (f: ProfileField) => [f.label, ...f.aliases].map(normalizeLabel).filter(Boolean);
  const exact = candidates.find((f) => names(f).includes(q));
  if (exact) return exact;
  let best: { f: ProfileField; len: number } | null = null;
  for (const f of candidates) for (const n of names(f)) if (n.length >= 4 && new RegExp(`\\b${n}\\b`).test(q) && n.length > (best?.len ?? 0)) best = { f, len: n.length };
  if (best) return best.f;
  const qWords = new Set(q.split(" "));
  for (const f of candidates) for (const n of names(f)) {
    const words = n.split(" "); const shared = words.filter((w) => qWords.has(w)).length;
    if (words.length >= 2 && shared / Math.max(words.length, qWords.size) >= 0.6) return f;
  }
  return null;
}
