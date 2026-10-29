"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PortalShell } from "@/components/portal/PortalShell";
import { PortalAuthError, PortalMe, PortalRepair, RepairOptions, formatDate, portalRequest } from "@/lib/portalApi";

const STATUS: Record<PortalRepair["status"], { text: string; cls: string }> = {
  open: { text: "Waiting for the office", cls: "bg-amber-100 text-amber-800" },
  in_progress: { text: "Being worked on", cls: "bg-blue-100 text-blue-800" },
  resolved: { text: "Done", cls: "bg-green-100 text-green-800" },
  declined: { text: "Not accepted", cls: "bg-red-100 text-red-800" },
  cancelled: { text: "Cancelled", cls: "bg-slate-100 text-slate-600" },
};

function Repairs({ code, me }: { code: string; me: PortalMe }) {
  const router = useRouter();
  const [opts, setOpts] = useState<RepairOptions | null>(null);
  const [list, setList] = useState<PortalRepair[]>([]);
  const [category, setCategory] = useState("");
  const [roomId, setRoomId] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const guard = useCallback((e: any) => (e instanceof PortalAuthError ? router.replace(`/portal/${code}/login`) : setError(e.message)), [code, router]);
  const load = useCallback(async () => {
    try {
      const [o, l] = await Promise.all([
        portalRequest<RepairOptions>(code, "/portal/repair-options"),
        portalRequest<{ repairs: PortalRepair[] }>(code, "/portal/repairs"),
      ]);
      setOpts(o); setList(l.repairs);
      if (o.units.length === 1) setRoomId(o.units[0].room_id);
    } catch (e) { guard(e); }
  }, [code, guard]);
  useEffect(() => { load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setDone(null);
    try {
      await portalRequest(code, "/portal/repairs", { method: "POST", body: JSON.stringify({ category, description: text, room_id: roomId || null }) });
      setDone("Sent to your property office."); setText(""); setCategory("");
      await load();
    } catch (err) { guard(err); } finally { setBusy(false); }
  }
  async function cancel(id: string) {
    setError(null);
    try { await portalRequest(code, `/portal/repairs/${id}/cancel`, { method: "POST" }); await load(); } catch (e) { guard(e); }
  }

  const input = "w-full px-3 py-2 text-base bg-paper-card border border-border rounded-card outline-none focus:border-brass-dark";
  if (!opts) return <p className="text-sm text-ink/50">{error ?? "Loading…"}</p>;
  return (
    <>
      <div>
        <h1 className="font-display text-2xl font-semibold">Repair request</h1>
        <p className="text-sm text-ink/55 mt-1">Tell your property office about a problem that needs fixing.</p>
      </div>
      {error && <p className="text-sm text-stamp-red">{error}</p>}
      {done && <p className="text-sm text-accent">{done}</p>}

      {opts.units.length === 0 ? (
        <p className="text-sm text-ink/60">You don't have a current agreement, so a repair request can't be sent. Please contact your property office.</p>
      ) : (
        <form onSubmit={submit} className="card p-4 sm:p-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {opts.units.length > 1 && (
              <div>
                <label className="text-sm font-medium block mb-1">Which {me.unit.toLowerCase()}?</label>
                <select className={input} value={roomId} onChange={(e) => setRoomId(e.target.value)} required>
                  <option value="">Choose…</option>
                  {opts.units.map((u) => <option key={u.room_id} value={u.room_id}>{[u.building, `${me.unit} ${u.number}`].filter(Boolean).join(" — ")}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="text-sm font-medium block mb-1">What is it about?</label>
              <select className={input} value={category} onChange={(e) => setCategory(e.target.value)} required>
                <option value="">Choose…</option>
                {opts.categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Describe the problem</label>
            <textarea className={input} rows={4} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: the kitchen tap is leaking and the floor gets wet" required />
          </div>
          <button type="submit" disabled={busy || !category || text.trim().length < 5} className="px-5 py-2.5 rounded-card bg-ink text-paper disabled:opacity-50">{busy ? "Sending…" : "Send to office"}</button>
        </form>
      )}

      <h2 className="font-display text-xl font-semibold pt-2">My requests</h2>
      {list.length === 0 ? <p className="text-sm text-ink/55">You haven't sent any repair requests yet.</p> : (
        <div className="space-y-3">
          {list.map((r) => (
            <div key={r.id} className="card p-4 space-y-2">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.category ?? "Repair"}{r.unit ? ` · ${[r.unit.building, `${me.unit} ${r.unit.number}`].filter(Boolean).join(" — ")}` : ""}</p>
                  <p className="text-xs text-ink/55">{formatDate(r.created_at)}</p>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full ${STATUS[r.status].cls}`}>{STATUS[r.status].text}</span>
                {r.status === "open" && <button onClick={() => cancel(r.id)} className="text-sm px-3 py-1.5 border border-border rounded-card hover:bg-paper">Cancel</button>}
              </div>
              <p className="text-sm">“{r.message}”</p>
              {r.admin_reply && <p className="text-sm"><span className="text-ink/50">Reply from the office:</span> {r.admin_reply}</p>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default function PortalRepairsPage() {
  const { code } = useParams<{ code: string }>();
  return <PortalShell code={code} active="repairs">{(me) => (me.permissions.submit_repair ? <Repairs code={code} me={me} /> : <p className="text-sm text-ink/60">Your property office hasn't enabled this for your account.</p>)}</PortalShell>;
}
