import { useState, useEffect } from "react";
import type { RankedConnection, InteractionEvidence } from "@connex/shared";
import * as api from "../api/client.js";

export function TopConnectionsPage() {
  const [connections, setConnections] = useState<RankedConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [evidence, setEvidence] = useState<InteractionEvidence | null>(null);
  const [evidenceLoading, setEvidenceLoading] = useState(false);

  useEffect(() => {
    loadConnections();
  }, []);

  const loadConnections = async (company?: string) => {
    setLoading(true);
    setError("");
    try {
      const data = await api.getTopConnections(100, company || undefined);
      setConnections(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFilter = (e: React.FormEvent) => {
    e.preventDefault();
    loadConnections(companyFilter);
  };

  const handleClearFilter = () => {
    setCompanyFilter("");
    loadConnections();
  };

  const showEvidence = async (personId: number) => {
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
        <form onSubmit={handleFilter} className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="form-label">Filter by domain/company</label>
            <input
              className="form-input"
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              placeholder="e.g. google.com"
            />
          </div>
          <button type="submit" className="btn btn-primary">Filter</button>
          {companyFilter && (
            <button type="button" className="btn" onClick={handleClearFilter}>Clear</button>
          )}
        </form>
      </div>

      {error && <div className="error-msg mb-4">{error}</div>}

      {loading ? (
        <div className="text-secondary">Loading connections...</div>
      ) : connections.length === 0 ? (
        <div className="card">
          <p className="text-secondary">
            No ranked connections found. Connect your Google account and sync Gmail from the Profile page to discover your top connections.
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
                <th style={{ ...thStyle, textAlign: "right" }}>Interactions</th>
                <th style={{ ...thStyle, textAlign: "right" }}>Sent/Recv</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {connections.map((c, i) => (
                <tr
                  key={c.personId}
                  style={{ borderBottom: "1px solid #21262d", cursor: "pointer" }}
                  onClick={() => showEvidence(c.personId)}
                >
                  <td style={tdStyle} className="text-muted">{i + 1}</td>
                  <td style={tdStyle}>
                    <strong>{c.name}</strong>
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
                      position: "relative",
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
                    <span className="text-xs text-muted">details</span>
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
          onClick={() => { setEvidence(null); }}
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
                  <button
                    className="btn text-xs"
                    onClick={() => setEvidence(null)}
                  >
                    Close
                  </button>
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
