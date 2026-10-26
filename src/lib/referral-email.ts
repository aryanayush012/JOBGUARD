// Detects "someone referred you" emails. Pure functions (no DB) so they can be checked in isolation.
// Email text is untrusted input: it is only pattern-matched, never acted on.

export type DetectedReferral = {
  /** SYSTEM_EMAIL = employer/ATS confirmation; CONTACT_EMAIL = the person saying they did it (not confirmed). */
  source: "SYSTEM_EMAIL" | "CONTACT_EMAIL";
  referrerName: string;
  referrerEmail: string;
};

// A name word is a capitalised word or a single initial ("K."); only initials may carry a period,
// so "Rahul K. Mehta. Complete your application" stops at "Mehta".
const WORD = String.raw`(?:[A-Z]\.|[A-Z][a-zA-Z'’-]+)`;
const NAME = String.raw`(${WORD}(?:\s+${WORD}){0,3})`;
const NOT_A_NAME = /^(we|you|someone|somebody|an?|the|our|your|they|hi|hello|dear|congratulations|good|great|an employee|team|recruiting|talent)\b/i;

const SYSTEM_PHRASE = /you(?:'ve| have)? been referred|you were referred|has referred you|referred you (?:for|to)|(?:submitted|made) a referral for you/i;
// Case-sensitive on purpose: "referred by Priya" counts, "were you referred by an employee?" doesn't.
const REFERRED_BY_NAME = /[Rr]eferred by ["“']?[A-Z]/;
const CONTACT_CLAIM = /\b(?:i(?:'ve| have)?|i just)\s+(?:already\s+)?(?:referred you|submitted (?:your|the|a) referral|put in (?:a|your|the) referral)/i;
const AUTOMATED_SENDER = /no-?reply|notifications?@|talent|careers?@|jobs?@|recruit|hiring|^hr@|workday|greenhouse|lever\.co|icims|smartrecruiters|ashby|successfactors|taleo|jobvite/i;

export function parseFrom(from: string) {
  const email = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
  const name = from.replace(/<[^>]*>/, "").replace(/["']/g, "").trim();
  return { email: email.includes("@") ? email : "", name: name.includes("@") ? "" : name };
}

function referrerNameFrom(text: string, exclude: string[]) {
  const patterns = [
    new RegExp(String.raw`\b${NAME}\s+(?:has\s+)?(?:just\s+)?(?:referred|recommended)\s+you\b`),
    // "referred [to a job at Cohesity] by Aditi Bodake" — same sentence, optional quotes around the name
    new RegExp(String.raw`\b[Rr]eferred\b[^.!?\n]{0,80}?\bby\s+["“']?${NAME}`),
    new RegExp(String.raw`\b${NAME}\s+(?:has\s+)?(?:submitted|made)\s+a\s+referral`)
  ];
  const excluded = exclude.map((value) => value.trim().toLowerCase()).filter(Boolean);
  for (const pattern of patterns) {
    for (const match of text.matchAll(new RegExp(pattern, "g"))) {
      const name = match[1].replace(/[.'’-]+$/, "").trim();
      if (name.length >= 2 && !NOT_A_NAME.test(name) && !excluded.includes(name.toLowerCase())) return name.slice(0, 120);
    }
  }
  return "";
}

/** `exclude` = names that must not be taken as the referrer (e.g. company names). */
export function detectReferral(subject: string, text: string, from: string, exclude: string[] = []): DetectedReferral | null {
  const all = `${subject}\n${text}`;
  const sender = parseFrom(from);
  const automated = AUTOMATED_SENDER.test(sender.email);
  if (!automated && CONTACT_CLAIM.test(all)) {
    return { source: "CONTACT_EMAIL", referrerName: sender.name.slice(0, 120), referrerEmail: sender.email };
  }
  if (SYSTEM_PHRASE.test(all) || REFERRED_BY_NAME.test(all)) {
    return { source: "SYSTEM_EMAIL", referrerName: referrerNameFrom(all, exclude), referrerEmail: "" };
  }
  return null;
}
