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
  { key: "location", label: "Current location", group: "Personal", fromResume: true, aliases: ["city", "location", "current city", "address", "street", "street address", "address line 1", "where are you based"] },
  { key: "country", label: "Country", group: "Personal", fromResume: true, aliases: ["country of residence", "current country", "country you live in"] },
  { key: "linkedin", label: "LinkedIn", group: "Links", fromResume: true, aliases: ["linkedin url", "linkedin profile", "linked in", "linked in url", "linked in profile"] },
  { key: "github", label: "GitHub", group: "Links", fromResume: true, aliases: ["github url", "github profile"] },
  { key: "portfolio", label: "Portfolio / website", group: "Links", fromResume: true, aliases: ["website", "personal website", "portfolio url", "blog"] },
  { key: "currentCompany", label: "Current company", group: "Experience", fromResume: true, aliases: ["current employer", "company name", "company", "employer", "employer name", "organization", "organisation", "current organization", "current organisation"] },
  { key: "currentTitle", label: "Current job title", group: "Experience", fromResume: true, aliases: ["current title", "designation", "current role", "job title", "current position", "occupation title", "occupation", "position title", "current designation"] },
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

/** Diversity/personal questions are never filled or drafted: you answer them yourself, every time. */
export function isSensitive(label: string) {
  return /\b(gender|sex|race|racial|ethnic\w*|disabilit\w*|veteran|sexual orientation|pronouns?|religio\w*|caste|marital|date of birth|dob|age|pregnan\w*|criminal|convict\w*)\b/i.test(label);
}

/** Maps a saved answer onto a dropdown/radio's options ("Yes" ↔ "Yes, I am authorized", "30 days" ↔ "30 Days"). */
export function pickOption(value: string, options: string[]) {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  const opts = options.map((o) => ({ o, l: o.trim().toLowerCase() })).filter((x) => x.l && !/^(select|choose|--|please select)/.test(x.l));
  const yes = /^(yes|y|true|sure|willing|open)\b/.test(v), no = /^(no|n|false|not)\b/.test(v);
  return opts.find((x) => x.l === v)?.o
    ?? (yes ? opts.find((x) => /^yes\b/.test(x.l))?.o : no ? opts.find((x) => /^no\b/.test(x.l))?.o : undefined)
    ?? opts.find((x) => x.l.startsWith(v) || (v.length >= 3 && x.l.includes(v)))?.o
    ?? opts.find((x) => x.l.length >= 3 && v.includes(x.l))?.o
    ?? null;
}

export type FormQuestion = { id: string; label: string; options?: string[] };
export type PlannedAnswer = { id: string; value: string; source: "BANK"; key: string };
/** Splits a form's questions into answers from the bank, questions for the AI to draft, and sensitive ones left to you. */
export function planAnswers(questions: FormQuestion[], fields: ProfileField[]) {
  const answers: PlannedAnswer[] = []; const unknown: FormQuestion[] = []; const skipped: string[] = [];
  for (const q of questions) {
    if (isSensitive(q.label)) { skipped.push(q.id); continue; }
    const field = matchField(q.label, fields);
    const value = field && (q.options?.length ? pickOption(field.value, q.options) : field.value);
    if (field && value) answers.push({ id: q.id, value, source: "BANK", key: field.key });
    else unknown.push(q);
  }
  return { answers, unknown, skipped };
}

/** The profile as plain lines for the AI (company-specific answers from other companies left out). */
export function profileText(fields: ProfileField[]) {
  return fields.filter((f) => f.value && f.reusable).map((f) => `${f.label}: ${f.value}`).join("\n");
}

/** Finds the saved answer for a form question: exact label/alias, then the longest alias inside the question, then word overlap. */
export function matchField(question: string, fields: ProfileField[], { includeEmpty = false } = {}) {
  const q = normalizeLabel(question);
  // "Why join us?" is never answered by a standard field, nor is an earlier work-history row ("Company (entry 2)").
  if (!q || isCompanySpecific(question) || /\(entry \d+\)/i.test(question)) return null;
  const candidates = fields.filter((f) => (includeEmpty || f.value) && f.reusable);
  const names = (f: ProfileField) => [f.label, ...f.aliases].map(normalizeLabel).filter(Boolean);
  const exact = candidates.find((f) => names(f).includes(q));
  if (exact) return exact;
  // An alias inside a longer question. Single words ("company", "degree") only count in short questions,
  // so "Why do you want to join our company?" never becomes "Current company".
  const shortQuestion = q.split(" ").length <= 3;
  let best: { f: ProfileField; len: number } | null = null;
  for (const f of candidates) for (const n of names(f)) if (n.length >= 4 && (n.includes(" ") || shortQuestion) && new RegExp(`\\b${n}\\b`).test(q) && n.length > (best?.len ?? 0)) best = { f, len: n.length };
  if (best) return best.f;
  const qWords = new Set(q.split(" "));
  for (const f of candidates) for (const n of names(f)) {
    const words = n.split(" "); const shared = words.filter((w) => qWords.has(w)).length;
    if (words.length >= 2 && shared / Math.max(words.length, qWords.size) >= 0.6) return f;
  }
  return null;
}
