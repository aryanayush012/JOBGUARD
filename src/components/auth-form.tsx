"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

// `next` must already be validated server-side with safeNextPath.
export function AuthForm({ mode, next }: { mode: "login" | "register"; next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch(`/api/v1/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const data = await response.json();

      if (!response.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        return;
      }

      router.replace(next);
      router.refresh();
    } catch {
      setError("Could not connect. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="field">
        <label htmlFor={`${mode}-email`}>Email</label>
        <input
          id={`${mode}-email`}
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={`${mode}-password`}>Password</label>
        <input
          id={`${mode}-password`}
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          required
          minLength={mode === "register" ? 12 : 1}
          maxLength={128}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {mode === "register" && <span className="muted small">Use at least 12 characters.</span>}
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="button" style={{ width: "100%", marginTop: 8 }} disabled={busy}>
        {busy ? "Please wait…" : mode === "login" ? "Log in" : "Create account"}
      </button>
    </form>
  );
}
