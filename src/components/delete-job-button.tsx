"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteJobButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!window.confirm("Delete this job permanently? This can't be undone.")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/jobs/${jobId}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        window.alert(data.error || "Could not delete the job.");
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return <button className="button secondary" style={{ color: "var(--danger)", borderColor: "var(--danger)" }} onClick={remove} disabled={busy}>{busy ? "Deleting…" : "Delete job"}</button>;
}
