import React, { useState, useEffect, useCallback } from "react";
import type {
  ApiConnectionWithPeople,
  ApiPerson,
  RelationshipType,
  RankedConnection,
  InteractionEvidence,
} from "@connex/shared";
import { RELATIONSHIP_TYPES } from "@connex/shared";
import { useAuth } from "../hooks/useAuth.js";
import * as api from "../api/client.js";

type Tab = "platform" | "top";

export function ConnectionsPage() {
  const { person } = useAuth();
  const [tab, setTab] = useState<Tab>("platform");
  const [connections, setConnections] = useState<ApiConnectionWithPeople[]>([]);
  const [pending, setPending] = useState<ApiConnectionWithPeople[]>([]);
  const [topConns, setTopConns] = useState<RankedConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [showHidden, setShowHidden] = useState(false);

  // Evidence modal
  const [evidence, setEvidence] = useState<InteractionEvidence | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [conns, pend, top] = await Promise.all([
        api.getMyConnections(),
        api.getPendingConnections(),
        api.getTopConnections({ limit: 200, showHidden: true }),
      ]);
      setConnections(conns);
      setPending(pend);
      setTopConns(top);
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

  const handleToggleHide = async (personId: number, currentlyHidden?: boolean) => {
    try {
      if (currentlyHidden) await api.unhideContact(personId);
      else await api.hideContact(personId);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const showEvidenceModal = async (personId: number) => {
    setEvidenceLoading(true);
    try {
      setEvidence(await api.getConnectionEvidence(personId));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setEvidenceLoading(false);
    }
  };

  const getOtherPerson = (conn: ApiConnectionWithPeople): ApiPerson =>
    conn.sourcePersonId === person?.id ? conn.targetPerson : conn.sourcePerson;

  if (loading) return <div className="text-secondary">Loading...</div>;

  const visibleTop = showHidden ? topConns : topConns.filter((c) => !c.hidden);
  // Backend already orders hidden-last, but re-sort defensively so UI is robust
  // even if a stale response arrives out of order.
  const sortedTop = [...visibleTop].sort(
    (a, b) => Number(a.hidden) - Number(b.hidden) || b.tieStrength - a.tieStrength,
  );

  return (
    <div>
      <div className="page-header flex justify-between items-center">
        <div>
          <h1 className="page-title">Connections</h1>
          <p className="page-subtitle">Your platform network and email-derived top contacts</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAddForm(!showAddForm)}>
          {showAddForm ? "Cancel" : "Connect with User"}
        </button>
      </div>

      {error && <div className="error-msg mb-4">{error}</div>}

      {showAddForm && person && (
        <AddConnectionForm myPersonId={person.id} onDone={() => { setShowAddForm(false); load(); }} />
      )}

      {/* Pending requests always visible at top */}
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
                  <button className="btn btn-success btn-sm" onClick={() => handleRespond(conn.id, "accepted")}>Accept</button>
                  <button className="btn btn-danger btn-sm" onClick={() => handleRespond(conn.id, "rejected")}>Reject</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {(["platform", "top"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`btn ${tab === t ? "btn-primary" : ""}`}
            onClick={() => setTab(t)}
          >
            {t === "platform"
              ? `Platform Connections (${connections.length})`
              : `Top Contacts (${topConns.filter((c) => !c.hidden).length})`}
          </button>
        ))}
        {tab === "top" && (
          <label className="text-xs text-muted" style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", marginLeft: "auto" }}>
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
            Show hidden
          </label>
        )}
      </div>

      {tab === "platform" && (
        connections.length === 0 ? (
          <div className="card text-secondary text-sm">
            No platform connections yet. Use <strong>Connect with User</strong> to send a
            connection request to another registered user (LinkedIn-style).
          </div>
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
                    <span className={`badge badge-${conn.relationshipType}`}>{conn.relationshipType}</span>
                    <span className={`badge badge-${conn.status}`}>{conn.status}</span>
                  </div>
                </div>
                {conn.note && <div className="text-xs text-muted mt-2">{conn.note}</div>}
                <div className="text-xs text-muted mt-2">Closeness: {conn.closenessScore}/10</div>
              </div>
            );
          })
        )
      )}

      {tab === "top" && (
        sortedTop.length === 0 ? (
          <div className="card text-secondary text-sm">
            No ranked contacts yet. Sync Gmail from the <a href="/profile">Profile</a> page to populate.
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-tertiary)" }}>
                  <th style={thStyle}>#</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Email</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Strength</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Msgs</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {sortedTop.map((c, i) => (
                  <tr
                    key={c.personId}
                    className={c.hidden ? "top-row-hidden" : ""}
                    style={{ borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                    onClick={() => showEvidenceModal(c.personId)}
                  >
                    <td style={tdStyle} className="text-muted">{i + 1}</td>
                    <td style={tdStyle}>
                      <strong>{c.name}</strong>
                      {c.isUser && (
                        <span className="badge badge-accepted" style={{ marginLeft: 6 }}>User</span>
                      )}
                      {c.hidden && (
                        <span className="text-xs text-muted" style={{ marginLeft: 4 }}>(hidden)</span>
                      )}
                    </td>
                    <td style={tdStyle} className="text-secondary text-sm">{c.email}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <span className="strength-bar">
                        <span
                          className="strength-fill"
                          style={{
                            width: `${Math.round(c.tieStrength * 100)}%`,
                            background:
                              c.tieStrength > 0.7 ? "var(--success)" :
                              c.tieStrength > 0.3 ? "var(--warning)" :
                              "var(--text-muted)",
                          }}
                        />
                      </span>
                      <span className="text-xs text-muted" style={{ marginLeft: 6 }}>
                        {(c.tieStrength * 100).toFixed(0)}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }} className="text-sm">{c.interactionCount}</td>
                    <td style={tdStyle}>
                      <button
                        className="btn text-xs"
                        style={{ padding: "2px 8px" }}
                        onClick={(e) => { e.stopPropagation(); handleToggleHide(c.personId, c.hidden); }}
                      >
                        {c.hidden ? "Unhide" : "Hide"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {(evidence || evidenceLoading) && (
        <EvidenceModal
          evidence={evidence}
          loading={evidenceLoading}
          onClose={() => setEvidence(null)}
        />
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function AddConnectionForm({ myPersonId, onDone }: { myPersonId: number; onDone: () => void }) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ApiPerson[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<ApiPerson | null>(null);
  const [type, setType] = useState<RelationshipType>("friend");
  const [closeness, setCloseness] = useState(5);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);

  // Debounced search, restricted to registered users.
  useEffect(() => {
    if (search.length < 1) { setResults([]); return; }
    setSearching(true);
    const timer = setTimeout(() => {
      api.searchPersons(search, { usersOnly: true })
        .then((r) => setResults(r.filter((p) => p.id !== myPersonId)))
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [search, myPersonId]);

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
      <div className="card-header">Send Connection Request</div>
      <p className="text-xs text-muted mb-2">
        Only registered platform users can receive connection requests. They'll
        see your request in their pending queue.
      </p>
      {error && <div className="error-msg">{error}</div>}

      {!selectedPerson ? (
        <div>
          <div className="form-group">
            <label className="form-label">Search for a user</label>
            <input
              className="form-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name or email…"
            />
          </div>
          {searching && <div className="text-xs text-muted">Searching…</div>}
          {results.map((p) => (
            <div key={p.id} className="search-result" onClick={() => setSelectedPerson(p)}>
              <span className="font-medium">{p.name}</span>
              {p.email && <span className="text-sm text-secondary"> · {p.email}</span>}
              {p.company && <span className="text-sm text-secondary"> · {p.company}</span>}
            </div>
          ))}
          {search && !searching && results.length === 0 && (
            <div className="text-xs text-muted">No registered users match "{search}".</div>
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="mb-2 text-sm">
            Request to: <strong>{selectedPerson.name}</strong>
            <button type="button" className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => setSelectedPerson(null)}>Change</button>
          </div>
          <div className="form-group">
            <label className="form-label">Relationship Type</label>
            <select className="form-select" value={type} onChange={(e) => setType(e.target.value as RelationshipType)}>
              {RELATIONSHIP_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
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
          <button type="submit" className="btn btn-primary">Send Request</button>
        </form>
      )}
    </div>
  );
}

function EvidenceModal({ evidence, loading, onClose }: {
  evidence: InteractionEvidence | null;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div className="card" style={{ width: 480, maxHeight: "80vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
        {loading ? (
          <div className="text-secondary">Loading evidence...</div>
        ) : evidence ? (
          <>
            <div className="card-header flex justify-between items-center">
              <span>Interaction Evidence: {evidence.name}</span>
              <button className="btn text-xs" onClick={onClose}>Close</button>
            </div>
            <div className="text-sm text-secondary mb-2">{evidence.email}</div>
            <dl className="person-detail" style={{ fontSize: 13 }}>
              <dt>Total interactions</dt><dd>{evidence.totalInteractions}</dd>
              <dt>Sent / Received</dt><dd>{evidence.sentCount} / {evidence.receivedCount}</dd>
              <dt>Direct / CC</dt><dd>{evidence.directCount} / {evidence.ccCount}</dd>
              <dt>Unique threads</dt><dd>{evidence.topThreads}</dd>
              <dt>First interaction</dt>
              <dd>{evidence.firstInteractionAt ? new Date(evidence.firstInteractionAt).toLocaleDateString() : "N/A"}</dd>
              <dt>Last interaction</dt>
              <dd>{evidence.lastInteractionAt ? new Date(evidence.lastInteractionAt).toLocaleDateString() : "N/A"}</dd>
            </dl>
            <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <div className="text-xs text-muted mb-2">Recency breakdown</div>
              <div className="flex gap-4 text-sm">
                <div><div className="font-medium">{evidence.recencyBuckets.last7days}</div><div className="text-xs text-muted">7 days</div></div>
                <div><div className="font-medium">{evidence.recencyBuckets.last30days}</div><div className="text-xs text-muted">30 days</div></div>
                <div><div className="font-medium">{evidence.recencyBuckets.last90days}</div><div className="text-xs text-muted">90 days</div></div>
                <div><div className="font-medium">{evidence.recencyBuckets.older}</div><div className="text-xs text-muted">Older</div></div>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = { padding: "10px 12px", textAlign: "left", fontSize: 12, fontWeight: 500, color: "var(--text-secondary)", whiteSpace: "nowrap" };
const tdStyle: React.CSSProperties = { padding: "10px 12px", fontSize: 13, whiteSpace: "nowrap" };
