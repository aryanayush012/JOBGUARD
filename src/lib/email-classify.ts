/** What a job email means. First match wins, so the order of the checks matters. */
export function classify(subject: string, text: string) {
  const all = `${subject}\n${text}`.toLowerCase();
  if (/application.{0,35}(was )?rejected|not moving forward|regret to inform|unsuccessful in your application|decided to pursue other candidates/.test(all)) return { type: "APPLICATION_REJECTED", confidence: "HIGH", label: "Application rejection" };
  // Action-needed emails, checked before the generic "your application for" confirmation pattern below.
  if (/(complete|finish) your application|application (is )?incomplete|incomplete application|haven.t (finished|completed) your application/.test(all)) return { type: "COMPLETE_APPLICATION", confidence: "MEDIUM", label: "Finish your application" };
  if (/(online|coding|technical|take[- ]home) (assessment|test|challenge)|assessment invitation|invited to (take|complete) (an?|the) (assessment|test)|hackerrank|codility|codesignal|hackerearth|mettl/.test(all)) return { type: "ASSESSMENT_INVITE", confidence: "MEDIUM", label: "Assessment to complete" };
  if (/interview.{0,35}(invite|invitation|scheduled|availability)|schedule.{0,20}interview|technical interview|meet with.{0,30}(team|hiring manager)/.test(all)) return { type: "INTERVIEW_UPDATE", confidence: "MEDIUM", label: "Interview update" };
  if (/referral.{0,40}(submitted|successfully referred|has referred|was referred)|referred you for|employee referral.{0,30}(complete|submitted)/.test(all)) return { type: "REFERRAL_REPORTED", confidence: "MEDIUM", label: "Referral mentioned" };
  if (/thank you for applying|application (has been|was) received|successfully applied|we have received your application|application confirmation|your application for/.test(all)) return { type: "APPLICATION_SUBMITTED", confidence: "HIGH", label: "Application confirmation" };
  if (/under review|reviewing your application|application status update|recruiter.{0,25}(reached out|contact)|next steps in the hiring/.test(all)) return { type: "APPLICATION_UPDATE", confidence: "MEDIUM", label: "Application update" };
  if (/job.{0,20}(closed|no longer available)|position.{0,20}(filled|closed)|applications are now closed/.test(all)) return { type: "JOB_CLOSED_NOTICE", confidence: "MEDIUM", label: "Job closure mentioned" };
  return null;
}

/**
 * The verification code or link in an account-verification email (Workday and other application sites).
 * Returns null when the email has neither.
 */
export function extractVerification(subject: string, text: string, links: string[] = []) {
  const all = `${subject}\n${text}`;
  if (!/verif|one[- ]time|otp|passcode|security code|confirm (your )?(email|account)|activate/i.test(all)) return null;
  // "code is 482913", "OTP: 4F7K2Q", or "482913 is your passcode". A code must contain a digit, so words like "expires" never count.
  const after = /\b(?:code|otp|passcode|pin)\s*(?:is|:)?\s*([0-9]{4,8}|(?=[a-z]*[0-9])[a-z0-9]{6,8})\b/i.exec(all);
  const before = /\b([0-9]{4,8})\s+is (?:your|the)\b/i.exec(all);
  const code = after?.[1] ?? before?.[1] ?? null;
  const usable = code && !/^(19|20)\d{2}$/.test(code) && /\d/.test(code) ? code : null;
  const link = links.find((l) => /verif|confirm|activate|validate/i.test(l) && /^https:\/\//.test(l)) ?? null;
  return usable || link ? { code: usable, link } : null;
}
