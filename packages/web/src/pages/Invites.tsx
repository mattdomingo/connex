import { FormEvent, useEffect, useState } from "react";
import type { Invite } from "@connex/shared";
import { api } from "../api/client";

export default function InvitesPage() {
  const [list, setList] = useState<Invite[]>([]);
  const [intendedName, setIntendedName] = useState("");
  const [intendedEmail, setIntendedEmail] = useState("");
  const [maxUses, setMaxUses] = useState(1);
  const [expiresInHours, setExpiresInHours] = useState<number | "">("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setList(await api.listInvites());
  }
  useEffect(() => { load(); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await api.createInvite({
      intendedName: intendedName || undefined,
      intendedEmail: intendedEmail || undefined,
      maxUses,
      expiresInHours: expiresInHours === "" ? undefined : Number(expiresInHours),
    });
    setIntendedName("");
    setIntendedEmail("");
    setMaxUses(1);
    setExpiresInHours("");
    await load();
    setBusy(false);
  }

  async function revoke(id: number) {
    await api.revokeInvite(id);
    await load();
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <div className="panel">
        <h2>Create invite</h2>
        <form onSubmit={submit}>
          <div className="row">
            <div className="field">
              <label>Intended name (optional)</label>
              <input value={intendedName} onChange={(e) => setIntendedName(e.target.value)} />
            </div>
            <div className="field">
              <label>Intended email (optional)</label>
              <input type="email" value={intendedEmail} onChange={(e) => setIntendedEmail(e.target.value)} />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Max uses</label>
              <input
                type="number"
                min={1}
                max={100}
                value={maxUses}
                onChange={(e) => setMaxUses(Number(e.target.value))}
              />
            </div>
            <div className="field">
              <label>Expires in (hours, optional)</label>
              <input
                type="number"
                min={1}
                value={expiresInHours}
                onChange={(e) =>
                  setExpiresInHours(e.target.value === "" ? "" : Number(e.target.value))
                }
              />
            </div>
          </div>
          <button type="submit" disabled={busy}>Generate invite</button>
        </form>
      </div>

      <div className="panel">
        <h2>Your invites</h2>
        {list.length === 0 && <div className="empty">No invites yet.</div>}
        {list.map((inv) => (
          <div key={inv.id} className="list-item">
            <div className="title">
              <code style={{ fontSize: 15 }}>{inv.code}</code>
              {inv.revoked && <span className="badge" style={{ marginLeft: 8 }}>revoked</span>}
            </div>
            <div className="sub">
              {inv.intendedName && `For: ${inv.intendedName} · `}
              {inv.intendedEmail && `${inv.intendedEmail} · `}
              Uses: {inv.usedCount}/{inv.maxUses}
              {inv.expiresAt && ` · Expires ${new Date(inv.expiresAt).toLocaleString()}`}
            </div>
            <div className="sub">
              Link: <code>{window.location.origin}/register?invite={inv.code}</code>
            </div>
            {!inv.revoked && (
              <button
                className="secondary"
                style={{ marginTop: 8 }}
                onClick={() => revoke(inv.id)}
              >
                Revoke
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
