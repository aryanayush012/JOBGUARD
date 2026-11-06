"use client";

import { useMemo, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { SEGMENTS, type Analytics, type AnalyticsJob, type SegmentKey } from "@/lib/analytics";

type Filter =
  | { kind: "segment"; key: SegmentKey }
  | { kind: "group"; group: "Applied" | "Open" | "Missed" | "Referred" }
  | { kind: "referrer"; name: string }
  | { kind: "company"; name: string }
  | null;
type Tip = { x: number; y: number; body: ReactNode } | null;

const SEG = Object.fromEntries(SEGMENTS.map((s, i) => [s.key, { ...s, color: `var(--seg-${i + 1})` }])) as Record<SegmentKey, typeof SEGMENTS[number] & { color: string }>;
const REFERRED: SegmentKey[] = ["applied-referred", "referred", "missed-referred"];
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function matches(job: AnalyticsJob, f: Filter) {
  if (!f) return true;
  if (f.kind === "segment") return job.segment === f.key;
  if (f.kind === "group") return f.group === "Referred" ? REFERRED.includes(job.segment) : SEG[job.segment].group === f.group;
  if (f.kind === "referrer") return job.referrers.some((r) => same(r, f.name));
  return same(job.company, f.name);
}
function filterLabel(f: NonNullable<Filter>) {
  return f.kind === "segment" ? SEG[f.key].label : f.kind === "group" ? `All ${f.group.toLowerCase()}` : f.kind === "referrer" ? `Referred by ${f.name}` : f.name;
}
// Click/Enter/Space all select; selecting the active filter again clears it.
function pressable(onPress: () => void) {
  return { role: "button", tabIndex: 0, onClick: onPress, onKeyDown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPress(); } } };
}

export function AnalyticsView({ data }: { data: Analytics }) {
  const [filter, setFilter] = useState<Filter>(null);
  const [hover, setHover] = useState<Filter>(null);
  const toggle = (f: NonNullable<Filter>) => setFilter((cur) => (JSON.stringify(cur) === JSON.stringify(f) ? null : f));
  const active = hover ?? filter; // hover previews, click pins
  const visibleJobs = data.jobs.filter((j) => matches(j, filter));
  const { totals } = data;

  if (!totals.jobs) return <section className="panel"><h2>No jobs yet</h2><p className="muted">Save a few jobs from the dashboard and your analytics will show up here.</p></section>;

  const tiles: { label: string; value: number; sub: string; f: NonNullable<Filter> | null }[] = [
    { label: "Jobs tracked", value: totals.jobs, sub: "everything you've saved", f: null },
    { label: "Applied", value: totals.applied, sub: `${pct(totals.applied, totals.jobs)}% of jobs`, f: { kind: "group", group: "Applied" } },
    { label: "Referred", value: totals.referred, sub: `${pct(totals.referred, totals.jobs)}% · ${totals.referrers} referrer${totals.referrers === 1 ? "" : "s"}`, f: { kind: "group", group: "Referred" } },
    { label: "Open", value: totals.open, sub: "deadline still ahead", f: { kind: "group", group: "Open" } },
    { label: "Missed", value: totals.missed, sub: "deadline passed, not applied", f: { kind: "group", group: "Missed" } }
  ];

  return (
    <div className="viz-root">
      <section className="kpi-row" aria-label="Summary">
        {tiles.map((t) => {
          const on = t.f && JSON.stringify(filter) === JSON.stringify(t.f);
          return (
            <div key={t.label} className={`panel kpi${t.f ? " kpi-pressable" : ""}${on ? " is-on" : ""}`} aria-pressed={t.f ? Boolean(on) : undefined}
              {...(t.f ? pressable(() => toggle(t.f!)) : {})}>
              <span className="kpi-label">{t.label}</span>
              <strong className="kpi-value">{t.value}</strong>
              <span className="kpi-sub">{t.sub}</span>
            </div>
          );
        })}
      </section>

      <section className="viz-grid">
        <Donut data={data} active={active} filter={filter} setHover={setHover} toggle={toggle} />
        <Network data={data} active={active} filter={filter} setHover={setHover} toggle={toggle} />
      </section>

      <section className="panel viz-card">
        <div className="viz-card-head">
          <div><h2>Jobs</h2><p className="muted small">The table view of both charts. Click a chart, a tile or a name to filter it.</p></div>
          {filter && <button className="filter-pill" onClick={() => setFilter(null)} aria-label={`Clear filter: ${filterLabel(filter)}`}>{filterLabel(filter)} <span aria-hidden="true">×</span></button>}
        </div>
        <div className="viz-table-wrap">
          <table className="viz-table">
            <thead><tr><th>Role</th><th>Company</th><th>Status</th><th>Referred by</th><th>Deadline</th></tr></thead>
            <tbody>
              {visibleJobs.map((job) => (
                <tr key={job.id}>
                  <td><a href={`/jobs/${job.id}`}>{job.title}</a></td>
                  <td><button className="link-button" onClick={() => toggle({ kind: "company", name: job.company })}>{job.company}</button></td>
                  <td><span className="seg-tag"><i style={{ background: SEG[job.segment].color }} />{SEG[job.segment].label}</span></td>
                  <td>{job.referrers.length ? job.referrers.map((r, i) => <span key={r}>{i > 0 && ", "}<button className="link-button" onClick={() => toggle({ kind: "referrer", name: r })}>{r}</button></span>) : <span className="muted">—</span>}</td>
                  <td className="num">{job.deadline ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: "Asia/Kolkata" }).format(new Date(job.deadline)) : <span className="muted">—</span>}</td>
                </tr>
              ))}
              {!visibleJobs.length && <tr><td colSpan={5} className="muted">No jobs match this filter.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

type ChartProps = { data: Analytics; active: Filter; filter: Filter; setHover: (f: Filter) => void; toggle: (f: NonNullable<Filter>) => void };

function useTip() {
  const [tip, setTip] = useState<Tip>(null);
  const move = (e: MouseEvent, body: ReactNode) => {
    const box = (e.currentTarget as Element).closest(".viz-card")!.getBoundingClientRect();
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, body });
  };
  const el = tip && <div className="viz-tip" style={{ left: tip.x, top: tip.y }} role="status">{tip.body}</div>;
  return { move, hide: () => setTip(null), el };
}

/* ---------- Donut: part-to-whole of the six exclusive outcomes ---------- */
function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number) {
  const p = (r: number, a: number) => `${cx + r * Math.sin(a)} ${cy - r * Math.cos(a)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(r1, a0)} A${r1} ${r1} 0 ${large} 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
}

function Donut({ data, active, filter, setHover, toggle }: ChartProps) {
  const { move, hide, el } = useTip();
  const total = data.totals.jobs;
  const live = SEGMENTS.filter((s) => data.counts[s.key] > 0);
  const gap = live.length > 1 ? 0.03 : 0; // ~2px surface gap between segments
  let angle = 0;
  const arcs = live.map((s) => {
    const sweep = (data.counts[s.key] / total) * Math.PI * 2;
    const a0 = angle + gap / 2, a1 = angle + Math.min(sweep, Math.PI * 2 - 0.0001) - gap / 2;
    angle += sweep;
    return { ...s, a0, a1, mid: (a0 + a1) / 2 };
  });
  const lit = (key: SegmentKey) => !active || (active.kind === "segment" ? active.key === key : active.kind === "group" ? (active.group === "Referred" ? REFERRED.includes(key) : SEG[key].group === active.group) : data.jobs.some((j) => j.segment === key && matches(j, active)));
  const centre = active?.kind === "segment" ? { n: data.counts[active.key], label: SEG[active.key].label } : { n: total, label: "jobs tracked" };
  const groups = ["Applied", "Open", "Missed"] as const;

  return (
    <div className="panel viz-card donut-card">
      <div className="viz-card-head"><div><h2>Where every job stands</h2><p className="muted small">Each job counts once. Referred jobs are split out of each outcome.</p></div></div>
      <div className="donut-layout">
        <svg viewBox="0 0 240 240" className="donut" role="img" aria-label={`${total} jobs: ${live.map((s) => `${s.label} ${data.counts[s.key]}`).join(", ")}`} onMouseLeave={() => { hide(); setHover(null); }}>
          {arcs.map((a) => {
            const on = lit(a.key), pinned = filter?.kind === "segment" && filter.key === a.key;
            const nudge = pinned || (active?.kind === "segment" && active.key === a.key) ? 6 : 0;
            return (
              <path key={a.key} d={arcPath(120, 120, 70, 108, a.a0, a.a1)} fill={SEG[a.key].color}
                className={`donut-seg${on ? "" : " is-dim"}`} aria-label={`${a.label}: ${data.counts[a.key]}`} aria-pressed={pinned}
                style={{ transform: `translate(${Math.sin(a.mid) * nudge}px, ${-Math.cos(a.mid) * nudge}px)` }}
                {...pressable(() => toggle({ kind: "segment", key: a.key }))}
                onMouseEnter={() => setHover({ kind: "segment", key: a.key })}
                onMouseMove={(e) => move(e, <><b>{a.label}</b><span>{data.counts[a.key]} job{data.counts[a.key] === 1 ? "" : "s"} · {pct(data.counts[a.key], total)}%</span></>)}
                onFocus={() => setHover({ kind: "segment", key: a.key })} onBlur={() => setHover(null)} />
            );
          })}
          <text x="120" y="116" textAnchor="middle" className="donut-value">{centre.n}</text>
          <text x="120" y="140" textAnchor="middle" className="donut-caption">{centre.label.length > 22 ? centre.label.slice(0, 21) + "…" : centre.label}</text>
        </svg>
        <div className="legend">
          {groups.map((g) => {
            const keys = SEGMENTS.filter((s) => s.group === g);
            const n = keys.reduce((sum, s) => sum + data.counts[s.key], 0);
            return (
              <div key={g} className="legend-group">
                <button className={`legend-group-head${filter?.kind === "group" && filter.group === g ? " is-on" : ""}`} onClick={() => toggle({ kind: "group", group: g })}
                  onMouseEnter={() => setHover({ kind: "group", group: g })} onMouseLeave={() => setHover(null)}>
                  <span>{g}</span><span className="num">{n} · {pct(n, total)}%</span>
                </button>
                {keys.map((s) => (
                  <button key={s.key} className={`legend-row${data.counts[s.key] ? "" : " is-empty"}${filter?.kind === "segment" && filter.key === s.key ? " is-on" : ""}${lit(s.key) ? "" : " is-dim"}`}
                    onClick={() => toggle({ kind: "segment", key: s.key })} onMouseEnter={() => setHover({ kind: "segment", key: s.key })} onMouseLeave={() => setHover(null)}>
                    <i style={{ background: SEG[s.key].color }} /><span>{s.label}</span><span className="num">{data.counts[s.key]}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      {el}
    </div>
  );
}

/* ---------- Referral network: who referred you → which company, links coloured by outcome ---------- */
function Network({ data, active, filter, setHover, toggle }: ChartProps) {
  const { move, hide, el } = useTip();
  const { referrers, companies } = useMemo(() => {
    const count = (key: "referrer" | "company") => {
      const m = new Map<string, { name: string; n: number }>();
      for (const l of data.links) { const k = l[key].toLowerCase(); m.set(k, { name: m.get(k)?.name ?? l[key], n: (m.get(k)?.n ?? 0) + 1 }); }
      return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
    };
    return { referrers: count("referrer"), companies: count("company") };
  }, [data.links]);

  if (!data.links.length) {
    return (
      <div className="panel viz-card network-card">
        <div className="viz-card-head"><div><h2>Referral network</h2><p className="muted small">Who referred you, and where.</p></div></div>
        <div className="viz-empty"><p>No referrals yet.</p><p className="muted small">Switch on “Got referral” on a job (with the person’s name), or let Gmail sync detect referral emails. They’ll appear here as a network.</p></div>
      </div>
    );
  }

  const row = 46, top = 28, W = 560, xL = 170, xR = 390;
  const H = top * 2 + Math.max(referrers.length, companies.length, 1) * row;
  const y = (i: number, n: number) => top + (H - top * 2) * ((i + 0.5) / n);
  const yRef = new Map(referrers.map((r, i) => [r.name.toLowerCase(), y(i, referrers.length)]));
  const yCo = new Map(companies.map((c, i) => [c.name.toLowerCase(), y(i, companies.length)]));
  const jobById = new Map(data.jobs.map((j) => [j.id, j]));
  const linkOn = (l: Analytics["links"][number]) => !active || matches(jobById.get(l.jobId)!, active) && (active.kind !== "referrer" || same(l.referrer, active.name));
  const nodeOn = (kind: "referrer" | "company", name: string) => !active || data.links.some((l) => same(l[kind], name) && linkOn(l));
  const radius = (n: number) => Math.min(6 + n * 2, 14);
  const short = (s: string) => (s.length > 20 ? s.slice(0, 19) + "…" : s);

  return (
    <div className="panel viz-card network-card">
      <div className="viz-card-head"><div><h2>Referral network</h2><p className="muted small">{data.totals.referrers} referrer{data.totals.referrers === 1 ? "" : "s"} → {data.totals.companies} compan{data.totals.companies === 1 ? "y" : "ies"}. Lines are coloured by the job’s outcome.</p></div></div>
      <div className="network-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} className="network" role="img" aria-label={data.links.map((l) => `${l.referrer} referred you to ${l.company}`).join("; ")} onMouseLeave={() => { hide(); setHover(null); }}>
          <text x={xL} y={14} textAnchor="end" className="net-col">REFERRER</text>
          <text x={xR} y={14} className="net-col">COMPANY</text>
          {data.links.map((l, i) => {
            const job = jobById.get(l.jobId)!; const y0 = yRef.get(l.referrer.toLowerCase())!, y1 = yCo.get(l.company.toLowerCase())!;
            return (
              <g key={i} className={`net-link${linkOn(l) ? "" : " is-dim"}`}
                onMouseMove={(e) => move(e, <><b>{l.referrer} → {l.company}</b><span>{job.title}</span><span className="seg-tag"><i style={{ background: SEG[job.segment].color }} />{SEG[job.segment].label}</span></>)}
                onMouseLeave={hide}>
                <path d={`M${xL} ${y0} C${(xL + xR) / 2} ${y0}, ${(xL + xR) / 2} ${y1}, ${xR} ${y1}`} className="net-hit" />
                <path d={`M${xL} ${y0} C${(xL + xR) / 2} ${y0}, ${(xL + xR) / 2} ${y1}, ${xR} ${y1}`} stroke={SEG[job.segment].color} className="net-line" />
              </g>
            );
          })}
          {referrers.map((r) => {
            const f = { kind: "referrer", name: r.name } as const; const ny = yRef.get(r.name.toLowerCase())!;
            const pinned = filter?.kind === "referrer" && same(filter.name, r.name);
            return (
              <g key={r.name} className={`net-node${nodeOn("referrer", r.name) ? "" : " is-dim"}${pinned ? " is-on" : ""}`} aria-label={`${r.name}: ${r.n} referral${r.n === 1 ? "" : "s"}`} aria-pressed={pinned}
                {...pressable(() => toggle(f))} onMouseEnter={() => setHover(f)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(f)} onBlur={() => setHover(null)}>
                <rect x={0} y={ny - row / 2} width={xL + 16} height={row} className="net-node-hit" />
                <circle cx={xL} cy={ny} r={radius(r.n)} className="net-dot net-dot-person" />
                <text x={xL - radius(r.n) - 8} y={ny + 4} textAnchor="end" className="net-label">{short(r.name)}<title>{r.name}</title></text>
              </g>
            );
          })}
          {companies.map((c) => {
            const f = { kind: "company", name: c.name } as const; const ny = yCo.get(c.name.toLowerCase())!;
            const pinned = filter?.kind === "company" && same(filter.name, c.name);
            return (
              <g key={c.name} className={`net-node${nodeOn("company", c.name) ? "" : " is-dim"}${pinned ? " is-on" : ""}`} aria-label={`${c.name}: ${c.n} referral${c.n === 1 ? "" : "s"}`} aria-pressed={pinned}
                {...pressable(() => toggle(f))} onMouseEnter={() => setHover(f)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(f)} onBlur={() => setHover(null)}>
                <rect x={xR - 16} y={ny - row / 2} width={W - xR + 16} height={row} className="net-node-hit" />
                <circle cx={xR} cy={ny} r={radius(c.n)} className="net-dot net-dot-company" />
                <text x={xR + radius(c.n) + 8} y={ny + 4} className="net-label">{short(c.name)}<title>{c.name}</title></text>
                {c.n > 1 && <text x={xR + radius(c.n) + 8} y={ny + 19} className="net-sub">{c.n} referrals</text>}
              </g>
            );
          })}
        </svg>
      </div>
      {el}
    </div>
  );
}
