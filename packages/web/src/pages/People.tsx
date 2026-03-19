import { FormEvent, useEffect, useState } from "react";
import type { Person } from "@connex/shared";
import { api } from "../api/client";

export default function PeoplePage() {
  const [q, setQ] = useState("");
  const [list, setList] = useState<Person[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [school, setSchool] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setList(await api.listPeople(q));
  }

  useEffect(() => {
    const t = setTimeout(() => load(), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await api.createPerson({
      name,
      email: email || undefined,
      company: company || undefined,
      school: school || undefined,
      location: location || undefined,
    });
    setName("");
    setEmail("");
    setCompany("");
    setSchool("");
    setLocation("");
    await load();
    setBusy(false);
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="panel">
        <h2>Add a person (contact)</h2>
        <p className="hint">
          People added here are graph nodes that don't have an account yet. If
          they later register with a matching email, their account will claim
          this node.
        </p>
        <form onSubmit={submit}>
          <div className="row">
            <div className="field">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="field">
              <label>Email (optional)</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="row">
            <div className="field">
              <label>Company</label>
              <input value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
            <div className="field">
              <label>School</label>
              <input value={school} onChange={(e) => setSchool(e.target.value)} />
            </div>
            <div className="field">
              <label>Location</label>
              <input value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
          </div>
          <button type="submit" disabled={busy}>Add person</button>
        </form>
      </div>

      <div className="panel">
        <h2>All people</h2>
        <div className="field">
          <input
            placeholder="Search by name…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {list.map((p) => (
          <div key={p.id} className="list-item">
            <div className="title">
              {p.name}{" "}
              {p.isRegistered && <span className="badge reg">registered</span>}
            </div>
            <div className="sub">
              {[p.company, p.school, p.location].filter(Boolean).join(" · ")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
