import { useState, useEffect, useCallback } from "react";
import type {
  ApiConnectionWithPeople,
  ApiPerson,
  RelationshipType,
} from "@connex/shared";
import { RELATIONSHIP_TYPES } from "@connex/shared";
import { useAuth } from "../hooks/useAuth.js";
import * as api from "../api/client.js";

export function ConnectionsPage() {
  const { person } = useAuth();
  const [connections, setConnections] = useState<ApiConnectionWithPeople[]>([]);
  const [pending, setPending] = useState<ApiConnectionWithPeople[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [showAddPerson, setShowAddPerson] = useState(false);

  const load = useCallback(async () => {
    try {
      const [conns, pend] = await Promise.all([
        api.getMyConnections(),
        api.getPendingConnections(),
      ]);
      setConnections(conns);
      setPending(pend);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRespond = async (id: number, status: "accepted" | "rejected") => {
    try {
      await api.respondToConnection(id, { status });
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const getOtherPerson = (conn: ApiConnectionWithPeople): ApiPerson => {
    return conn.sourcePersonId === person?.id ? conn.targetPerson : conn.sourcePerson;
  };

  if (loading) return <div className="text-secondary">Loading...</div>;

  return (
    <div>
      <div className="page-header flex justify-between items-center">
        <div>
          <h1 className="page-title">Connections</h1>
          <p className="page-subtitle">Manage your relationships and pending requests</p>
        </div>
        <div className="flex gap-2">
          <button className="btn" onClick={() => setShowAddPerson(!showAddPerson)}>
            {showAddPerson ? "Cancel" : "Add Person"}
          </button>
          <button className="btn btn-primary" onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? "Cancel" : "New Connection"}
          </button>
        </div>
      </div>

      {error && <div className="error-msg mb-4">{error}</div>}

      {showAddPerson && (
        <AddPersonForm onDone={() => { setShowAddPerson(false); load(); }} />
      )}

      {showAddForm && person && (
        <AddConnectionForm myPersonId={person.id} onDone={() => { setShowAddForm(false); load(); }} />
      )}

      {pending.length > 0 && (
        <div className="mb-4">
          <h2 className="font-medium mb-2">Pending Requests ({pending.length})</h2>
          {pending.map((conn) => {
            const other = getOtherPerson(conn);
            return (
              <div key={conn.id} className="card flex justify-between items-center">
                <div>
                  <span className="font-medium">{other.name}</span>
                  <span className={`badge badge-${conn.relationshipType}`} style={{ marginLeft: 8 }}>
                    {conn.relationshipType}
                  </span>
                  {conn.note && <div className="text-xs text-muted mt-2">{conn.note}</div>}
                </div>
                <div className="flex gap-2">
                  <button className="btn btn-success btn-sm" onClick={() => handleRespond(conn.id, "accepted")}>
                    Accept
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleRespond(conn.id, "rejected")}>
                    Reject
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <h2 className="font-medium mb-2">All Connections ({connections.length})</h2>
      {connections.length === 0 ? (
        <div className="card text-secondary text-sm">No connections yet. Create one to get started.</div>
      ) : (
        connections.map((conn) => {
          const other = getOtherPerson(conn);
          return (
            <div key={conn.id} className="card">
              <div className="flex justify-between items-center">
                <div>
                  <span className="font-medium">{other.name}</span>
                  {other.company && <span className="text-sm text-secondary"> at {other.company}</span>}
                </div>
                <div className="flex gap-2">
                  <span className={`badge badge-${conn.relationshipType}`}>
                    {conn.relationshipType}
                  </span>
                  <span className={`badge badge-${conn.status}`}>
                    {conn.status}
                  </span>
                </div>
              </div>
              {conn.note && <div className="text-xs text-muted mt-2">{conn.note}</div>}
              <div className="text-xs text-muted mt-2">
                Closeness: {conn.closenessScore}/10
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

function AddPersonForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createPerson({ name, email: email || undefined, company: company || undefined });
      onDone();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="card mb-4">
      <div className="card-header">Add a Person (Contact)</div>
      {error && <div className="error-msg">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Name *</label>
          <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="form-group">
          <label className="form-label">Email (optional)</label>
          <input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Company (optional)</label>
          <input className="form-input" value={company} onChange={(e) => setCompany(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary">Add Person</button>
      </form>
    </div>
  );
}

function AddConnectionForm({ myPersonId, onDone }: { myPersonId: number; onDone: () => void }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ApiPerson[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<ApiPerson | null>(null);
  const [type, setType] = useState<RelationshipType>("friend");
  const [closeness, setCloseness] = useState(5);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const handleSearch = async () => {
    if (search.length < 1) return;
    try {
      const r = await api.searchPersons(search);
      setResults(r.filter((p) => p.id !== myPersonId));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPerson) return;
    try {
      await api.createConnection({
        sourcePersonId: myPersonId,
        targetPersonId: selectedPerson.id,
        relationshipType: type,
        closenessScore: closeness,
        note: note || undefined,
      });
      onDone();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="card mb-4">
      <div className="card-header">Create Connection</div>
      {error && <div className="error-msg">{error}</div>}

      {!selectedPerson ? (
        <div>
          <div className="form-group">
            <label className="form-label">Search for a person</label>
            <div className="flex gap-2">
              <input
                className="form-input flex-1"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleSearch())}
                placeholder="Type a name..."
              />
              <button type="button" className="btn" onClick={handleSearch}>Search</button>
            </div>
          </div>
          {results.map((p) => (
            <div
              key={p.id}
              className="search-result"
              onClick={() => setSelectedPerson(p)}
            >
              <span className="font-medium">{p.name}</span>
              {p.company && <span className="text-sm text-secondary"> at {p.company}</span>}
              {!p.userId && <span className="badge badge-other" style={{ marginLeft: 8 }}>Contact</span>}
            </div>
          ))}
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="mb-2 text-sm">
            Connecting to: <strong>{selectedPerson.name}</strong>
            <button type="button" className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setSelectedPerson(null)}>
              Change
            </button>
          </div>
          <div className="form-group">
            <label className="form-label">Relationship Type</label>
            <select className="form-select" value={type} onChange={(e) => setType(e.target.value as RelationshipType)}>
              {RELATIONSHIP_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Closeness (1-10): {closeness}</label>
            <input type="range" min={1} max={10} value={closeness} onChange={(e) => setCloseness(Number(e.target.value))} className="w-full" />
          </div>
          <div className="form-group">
            <label className="form-label">Note (optional)</label>
            <textarea className="form-textarea" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary">Create Connection</button>
        </form>
      )}
    </div>
  );
}
