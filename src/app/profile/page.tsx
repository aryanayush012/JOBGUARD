import Link from "next/link";
import { redirect } from "next/navigation";
import { ObjectId } from "mongodb";
import { getCurrentUser, getExtensionTokenStatus } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { loadProfile } from "@/lib/profile";
import { geminiConfigured } from "@/lib/gemini";
import { LogoutButton } from "@/components/logout-button";
import { ProfileView } from "@/components/profile-view";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/profile");
  const userId = new ObjectId(user.id);
  const [profile, tokenStatus] = await Promise.all([loadProfile(await getDb(), userId), getExtensionTokenStatus(userId)]);
  return (
    <main className="page">
      <nav className="nav">
        <Link href="/" className="brand" style={{ textDecoration: "none" }}>JOB<span>GUARD</span></Link>
        <div className="actions"><span className="muted small">{user.email}</span><LogoutButton /></div>
      </nav>
      <section className="hero">
        <p className="muted">PROFILE</p>
        <h1>Your answer bank.</h1>
        <p className="muted">Everything JobGuard uses to fill job applications for you, built from your resume and your own answers.</p>
      </section>
      <ProfileView initial={profile} aiEnabled={geminiConfigured()} tokenStatus={tokenStatus} />
      <Link href="/dashboard" className="fab" aria-label="Dashboard">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>
      </Link>
    </main>
  );
}
