import { useState, useEffect, useCallback } from "react";
import type { RankedConnection, InteractionEvidence } from "@connex/shared";
import * as api from "../api/client.js";

export function TopConnectionsPage() {
  const [connections, setConnections] = useState<RankedConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [evidence, setEvidence] = useState<InteractionEvidence | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  const loadConnections = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getTopConnections({
        limit: 100,
        q: searchQuery || undefined,
        company: companyFilter || undefined,
        showHidden,
      });
      setConnections(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, companyFilter, showHidden]);

  useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    loadConnections();
  };

  const handleClear = () => {
    setSearchQuery("");
    setCompanyFilter("");
  };

  const handleToggleHide = async (personId: number, currentlyHidden?: boolean) => {
    try {
      if (currentlyHidden) {
        await api.unhideContact(personId);
      } else {
        await api.hideContact(personId);
      }
      loadConnections();
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

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Top Connections</h1>
        <p className="page-subtitle">
          Your strongest relationships ranked by email interaction patterns
        </p>
      </div>

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
            <button type="button" className="btn" onClick={handleClear}>Clear</button>
          )}
          <label className="text-xs text-muted" style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            Show hidden
          </label>
        </form>
      </div>

      {error && <div className="error-msg mb-4">{error}</div>}

      {loading ? (
        <div className="text-secondary">Loading connections...</div>
      ) : connections.length === 0 ? (
        <div className="card">
          <p className="text-secondary">
            {searchQuery || companyFilter
              ? "No connections match your search. Try broadening your query."
              : "No ranked connections found. Connect your Google account and sync Gmail from the Profile page to discover your top connections."}
          </p>
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid #30363d", background: "#161b22" }}>
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
              {connections.map((c, i) => (
                <tr
                  key={c.personId}
                  style={{
                    borderBottom: "1px solid #21262d",
                    cursor: "pointer",
                    opacity: c.hidden ? 0.5 : 1,
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
                      background: "#21262d",
                      borderRadius: 4,
                      overflow: "hidden",
                      height: 6,
                    }}>
                      <span style={{
                        display: "block",
                        width: `${Math.round(c.tieStrength * 100)}%`,
                        height: "100%",
                        background: c.tieStrength > 0.7 ? "#3fb950" : c.tieStrength > 0.3 ? "#d29922" : "#8b949e",
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

                <div style={{ marginTop: 12, borderTop: "1px solid #30363d", paddingTop: 12 }}>
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

const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontSize: 12,
  fontWeight: 500,
  color: "#8b949e",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 13,
  whiteSpace: "nowrap",
};
