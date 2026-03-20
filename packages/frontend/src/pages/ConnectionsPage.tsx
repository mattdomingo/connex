import { useState, useEffect, useCallback } from "react";
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

export function ConnectionsPage() {
  const { person } = useAuth();
  const [connections, setConnections] = useState<ApiConnectionWithPeople[]>([]);
  const [pending, setPending] = useState<ApiConnectionWithPeople[]>([]);
  const [topConnections, setTopConnections] = useState<RankedConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  // Top connections filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");

  // Evidence modal
  const [evidence, setEvidence] = useState<InteractionEvidence | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [conns, pend, top] = await Promise.all([
        api.getMyConnections(),
        api.getPendingConnections(),
        api.getTopConnections({
          limit: 100,
          q: searchQuery || undefined,
          company: companyFilter || undefined,
          showHidden: true,
        }),
      ]);
      setConnections(conns);
      setPending(pend);
      setTopConnections(top);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, companyFilter]);

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
      if (currentlyHidden) {
        await api.unhideContact(personId);
      } else {
        await api.hideContact(personId);
      }
      load();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const showEvidenceModal = async (personId: number) => {
    setEvidenceLoading(true);
    try {
      const data = await api.getConnectionEvidence(personId);
      setEvidence(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setEvidenceLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    load();
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
          <p className="page-subtitle">Manage your relationships and ranked contacts</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-primary" onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? "Cancel" : "Connect with User"}
          </button>
        </div>
      </div>

      {error && <div className="error-msg mb-4">{error}</div>}

      {showAddForm && person && (
        <AddConnectionForm myPersonId={person.id} onDone={() => { setShowAddForm(false); load(); }} />
      )}

      {/* Pending requests */}
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

      {/* Manual connections */}
      {connections.length > 0 && (
        <div className="mb-4">
          <h2 className="font-medium mb-2">Your Connections ({connections.length})</h2>
          {connections.map((conn) => {
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
          })}
        </div>
      )}

      {/* Top connections (from Gmail sync) */}
      <div>
        <h2 className="font-medium mb-2">Ranked Connections (from Email)</h2>
        <p className="text-xs text-muted mb-2">
          Ranked by email interaction patterns. Hidden contacts appear greyed out at the bottom.
        </p>

        {/* Search/filter */}
        <div className="card mb-4">
          <form onSubmit={handleSearch} className="flex gap-2 items-end" style={{ flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 200px" }}>
              <label className="form-label">Search name / email</label>
              <input
                className="form-input"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="e.g. Alice, alice@example.com"
              />
            </div>
            <div style={{ flex: "1 1 160px" }}>
              <label className="form-label">Filter by domain</label>
              <input
                className="form-input"
                value={companyFilter}
                onChange={(e) => setCompanyFilter(e.target.value)}
                placeholder="e.g. google.com"
              />
            </div>
            <button type="submit" className="btn btn-primary">Search</button>
            {(searchQuery || companyFilter) && (
              <button type="button" className="btn" onClick={() => { setSearchQuery(""); setCompanyFilter(""); }}>Clear</button>
            )}
          </form>
        </div>

        {topConnections.length === 0 ? (
          <div className="card">
            <p className="text-secondary">
              {searchQuery || companyFilter
                ? "No connections match your search."
                : "No ranked connections found. Connect your Google account and sync Gmail from the Profile page."}
            </p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
                  <th style={thStyle}>#</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Domain</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Strength</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Msgs</th>
                  <th style={{ ...thStyle, textAlign: "right" }}>Sent/Recv</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {topConnections.map((c, i) => (
                  <tr
                    key={c.personId}
                    style={{
                      borderBottom: "1px solid var(--border)",
                      cursor: "pointer",
                      opacity: c.hidden ? 0.4 : 1,
                      color: c.hidden ? "var(--text-muted)" : undefined,
                    }}
                    onClick={() => showEvidenceModal(c.personId)}
                  >
                    <td style={tdStyle} className="text-muted">{i + 1}</td>
                    <td style={tdStyle}>
                      <strong>{c.name}</strong>
                      {c.hidden && <span className="text-xs text-muted" style={{ marginLeft: 4 }}>(hidden)</span>}
                    </td>
                    <td style={tdStyle} className="text-secondary text-sm">{c.email}</td>
                    <td style={tdStyle} className="text-muted text-sm">{c.domain}</td>
                    <td style={{ ...tdStyle, textAlign: "right" }}>
                      <span style={{
                        display: "inline-block",
                        width: 48,
                        background: "var(--bg-tertiary)",
                        borderRadius: 4,
                        overflow: "hidden",
                        height: 6,
                      }}>
                        <span style={{
                          display: "block",
                          width: `${Math.round(c.tieStrength * 100)}%`,
                          height: "100%",
                          background: c.tieStrength > 0.7 ? "var(--success)" : c.tieStrength > 0.3 ? "var(--warning)" : "var(--text-muted)",
                          borderRadius: 4,
                        }} />
                      </span>
                      <span className="text-xs text-muted" style={{ marginLeft: 6 }}>
                        {(c.tieStrength * 100).toFixed(0)}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }} className="text-sm">
                      {c.interactionCount}
                    </td>
                    <td style={{ ...tdStyle, textAlign: "right" }} className="text-xs text-muted">
                      {c.sentCount}/{c.receivedCount}
                    </td>
                    <td style={tdStyle}>
                      <button
                        className="btn text-xs"
                        style={{ padding: "2px 8px", opacity: 0.7 }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleHide(c.personId, c.hidden);
                        }}
                      >
                        {c.hidden ? "Show" : "Hide"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Evidence Modal */}
      {(evidence || evidenceLoading) && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setEvidence(null)}
        >
          <div
            className="card"
            style={{ width: 480, maxHeight: "80vh", overflow: "auto" }}
            onClick={(e) => e.stopPropagation()}
          >
            {evidenceLoading ? (
              <div className="text-secondary">Loading evidence...</div>
            ) : evidence ? (
              <>
                <div className="card-header flex justify-between items-center">
                  <span>Interaction Evidence: {evidence.name}</span>
                  <button className="btn text-xs" onClick={() => setEvidence(null)}>Close</button>
                </div>
                <div className="text-sm text-secondary mb-2">{evidence.email}</div>

                <dl className="person-detail" style={{ fontSize: 13 }}>
                  <dt>Total interactions</dt>
                  <dd>{evidence.totalInteractions}</dd>
                  <dt>Sent / Received</dt>
                  <dd>{evidence.sentCount} / {evidence.receivedCount}</dd>
                  <dt>Direct / CC</dt>
                  <dd>{evidence.directCount} / {evidence.ccCount}</dd>
                  <dt>Unique threads</dt>
                  <dd>{evidence.topThreads}</dd>
                  <dt>First interaction</dt>
                  <dd>{evidence.firstInteractionAt ? new Date(evidence.firstInteractionAt).toLocaleDateString() : "N/A"}</dd>
                  <dt>Last interaction</dt>
                  <dd>{evidence.lastInteractionAt ? new Date(evidence.lastInteractionAt).toLocaleDateString() : "N/A"}</dd>
                </dl>

                <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                  <div className="text-xs text-muted mb-2">Recency breakdown</div>
                  <div className="flex gap-4 text-sm">
                    <div>
                      <div className="font-medium">{evidence.recencyBuckets.last7days}</div>
                      <div className="text-xs text-muted">7 days</div>
                    </div>
                    <div>
                      <div className="font-medium">{evidence.recencyBuckets.last30days}</div>
                      <div className="text-xs text-muted">30 days</div>
                    </div>
                    <div>
                      <div className="font-medium">{evidence.recencyBuckets.last90days}</div>
                      <div className="text-xs text-muted">90 days</div>
                    </div>
                    <div>
                      <div className="font-medium">{evidence.recencyBuckets.older}</div>
                      <div className="text-xs text-muted">Older</div>
                    </div>
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/** Connection form — only searches for registered users (people with userId). */
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
      // Only show registered users (those with userId set)
      setResults(r.filter((p) => p.id !== myPersonId && p.userId !== null));
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
      <div className="card-header">Send Connection Request</div>
      <p className="text-xs text-muted mb-2">Search for registered users on the platform to connect with.</p>
      {error && <div className="error-msg">{error}</div>}

      {!selectedPerson ? (
        <div>
          <div className="form-group">
            <label className="form-label">Search for a user</label>
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
          {results.length === 0 && search.length > 0 && (
            <div className="text-xs text-muted">No registered users found. Only platform users can be connected.</div>
          )}
          {results.map((p) => (
            <div
              key={p.id}
              className="search-result"
              onClick={() => setSelectedPerson(p)}
            >
              <span className="font-medium">{p.name}</span>
              {p.company && <span className="text-sm text-secondary"> at {p.company}</span>}
              <span className="badge badge-coworker" style={{ marginLeft: 8 }}>User</span>
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
          <button type="submit" className="btn btn-primary">Send Connection Request</button>
        </form>
      )}
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontSize: 12,
  fontWeight: 500,
  color: "var(--text-secondary)",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 13,
  whiteSpace: "nowrap",
};
