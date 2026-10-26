"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      await fetch("/api/v1/auth/logout", { method: "POST" });
    } finally {
      router.replace("/login");
      router.refresh();
      setBusy(false);
    }
  }

  return <button className="button secondary" onClick={logout} disabled={busy}>{busy ? "Logging out…" : "Log out"}</button>;
}
