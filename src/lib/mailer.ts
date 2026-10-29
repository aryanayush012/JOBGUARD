import "server-only";
import nodemailer from "nodemailer";

/**
 * Sends a plain-text email from JobGuard's own Gmail account over SMTP (free, ~500/day),
 * so users never grant send access to their mailbox. Needs an app password, not the account password.
 */
export async function sendEmail(to: string, subject: string, text: string) {
  const user = process.env.SMTP_USER; const pass = process.env.SMTP_APP_PASSWORD;
  if (!user || !pass) throw new Error("Email is not configured. Set SMTP_USER and SMTP_APP_PASSWORD.");
  const transport = nodemailer.createTransport({ service: "gmail", auth: { user, pass: pass.replace(/\s+/g, "") } }); // Google shows app passwords with spaces
  await transport.sendMail({ from: `JobGuard <${user}>`, to, subject, text });
}
