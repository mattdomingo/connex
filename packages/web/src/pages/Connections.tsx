import { FormEvent, useEffect, useState } from "react";
import type { Connection, Person, RelationshipType } from "@connex/shared";
import { RELATIONSHIP_TYPES } from "@connex/shared";
import { api } from "../api/client";
import { useAuth } from "../api/auth-context";

export default function ConnectionsPage() {
  const { user } = useAuth();
  const [mine, setMine] = useState<Connection[]>([]);
  const [pending, setPending] = useState<Connection[]>([]);
  const [people, setPeople] = useState<Person[]>([]);

  const [source, setSource] = useState<number>(0);
  const [target, setTarget] = useState<number>(0);
  const [type, setType] = useState<RelationshipType>("friend");
  const [trust, setTrust] = useState(5);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) setSource(user.personId);
  }, [user]);

  async function load() {
    const [m, p, ppl] = await Promise.all([
      api.listConnections(),
      api.listPending(),
      api.listPeople(""),
    ]);
    setMine(m);
    setPending(p);
    setPeople(ppl);
  }
  useEffect(() => { load(); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.createConnection({
        sourcePersonId: source,
        targetPersonId: target,
        relationshipType: type,
        trustScore: trust,
        note: note || undefined,
      });
      setNote("");
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function respond(id: number, action: "accept" | "reject") {
    await api.respondConnection(id, action);
    await load();
  }

  if (!user) return null;

  const other = (c: Connection) =>
    c.aPersonId === user.personId ? c.b! : c.a!;

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="panel">
        <h2>Pending requests</h2>
        {pending.length === 0 && <div className="empty">No pending requests.</div>}
        {pending.map((c) => {
          const creator = c.a?.id === user.personId ? c.b! : c.a!;
          return (
            <div key={c.id} className="list-item">
              <div className="title">
                {creator.name} wants to connect as{" "}
                <span className="badge">{c.relationshipType}</span>
              </div>
              <div className="sub">
                Trust: {c.trustScore}/10 {c.note && `· "${c.note}"`}
              </div>
              <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                <button onClick={() => respond(c.id, "accept")}>Accept</button>
                <button className="secondary" onClick={() => respond(c.id, "reject")}>
                  Reject
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="panel">
        <h2>Add connection</h2>
        <form onSubmit={submit}>
          <div className="row">
            <div className="field">
              <label>Source</label>
              <select value={source} onChange={(e) => setSource(Number(e.target.value))}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.id === user.personId ? " (you)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Target</label>
              <select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
                <option value={0}>Choose…</option>
                {people
                  .filter((p) => p.id !== source)
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
              </select>
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Relationship</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as RelationshipType)}
              >
                {RELATIONSHIP_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Trust / closeness (1-10)</label>
              <input
                type="number"
                min={1}
                max={10}
                value={trust}
                onChange={(e) => setTrust(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="field">
            <label>Note (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          </div>
          {err && <div className="error">{err}</div>}
          <button type="submit" disabled={busy || !target}>Create</button>
          <span className="hint" style={{ marginLeft: 12 }}>
            Connections between two registered users start as pending until confirmed.
          </span>
        </form>
      </div>

      <div className="panel">
        <h2>Your connections</h2>
        {mine.length === 0 && <div className="empty">No connections yet.</div>}
        {mine.map((c) => {
          const o = other(c);
          return (
            <div key={c.id} className="list-item">
              <div className="title">
                {o.name}{" "}
                <span className="badge">{c.relationshipType}</span>
                {c.status === "pending" && (
                  <span className="badge pending">pending</span>
                )}
                {o.isRegistered && <span className="badge reg">registered</span>}
              </div>
              <div className="sub">
                Trust: {c.trustScore}/10
                {c.note && ` · "${c.note}"`}
                {" · "}
                Created {new Date(c.createdAt).toLocaleDateString()}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
