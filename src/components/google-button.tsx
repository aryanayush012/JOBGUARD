const ERRORS: Record<string, string> = {
  cancelled: "Google sign-in was cancelled.",
  "invalid-state": "That sign-in link expired or came from another browser. Please try again.",
  "unverified-email": "Your Google account's email isn't verified.",
  "account-disabled": "This account is disabled.",
  "connection-failed": "Couldn't sign in with Google. Please try again.",
  "not-configured": "Google sign-in isn't set up on this server."
};

/** "Continue with Google": signs in (or up), sharing only name and email. */
export function GoogleButton({ next, error }: { next: string; error?: string }) {
  return (
    <>
      {error && ERRORS[error] && <p className="error" role="alert">{ERRORS[error]}</p>}
      <a className="button secondary" style={{ width: "100%", display: "flex", justifyContent: "center", alignItems: "center", gap: 8, boxSizing: "border-box" }}
        href={`/api/integrations/gmail/connect?next=${encodeURIComponent(next)}`}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z"/><path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.6 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.1-13.5-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>
        Continue with Google
      </a>
      <p className="muted small" style={{ marginTop: 6 }}>JobGuard only receives your name and email address from Google. <a href="/privacy">Privacy</a></p>
      <p className="muted small" style={{ textAlign: "center" }}>or use email</p>
    </>
  );
}
