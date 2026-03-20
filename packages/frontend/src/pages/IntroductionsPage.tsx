import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { ApiIntroRequest, ApiPerson } from "@connex/shared";
import { useAuth } from "../hooks/useAuth.js";
import * as api from "../api/client.js";
import type { ReachablePerson, IntermediaryOption } from "../api/client.js";

type Tab = "create" | "sent" | "inbox";

export function IntroductionsPage() {
  const { person } = useAuth();
  const [searchParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>(searchParams.get("tab") as Tab || "create");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Create form state
  const prefillTarget = searchParams.get("targetId");
  const [reachablePeople, setReachablePeople] = useState<ReachablePerson[]>([]);
  const [targetFilter, setTargetFilter] = useState("");
  const [showTargetDropdown, setShowTargetDropdown] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<ReachablePerson | null>(null);

  const [intermediaries, setIntermediaries] = useState<IntermediaryOption[]>([]);
  const [selectedInter, setSelectedInter] = useState<IntermediaryOption | null>(null);
  const [totalDegrees, setTotalDegrees] = useState<number | null>(null);
  const [loadingIntermediaries, setLoadingIntermediaries] = useState(false);

  const [requestNote, setRequestNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Sent / Inbox
  const [sentRequests, setSentRequests] = useState<ApiIntroRequest[]>([]);
  const [inboxRequests, setInboxRequests] = useState<ApiIntroRequest[]>([]);
  const [loadingSent, setLoadingSent] = useState(false);
  const [loadingInbox, setLoadingInbox] = useState(false);

  // Response modal
  const [respondingTo, setRespondingTo] = useState<ApiIntroRequest | null>(null);
  const [responseNote, setResponseNote] = useState("");

  // Load reachable people on mount
  useEffect(() => {
    api.getReachablePeople().then(setReachablePeople).catch(() => {});
  }, []);

  // Prefill target from query param
  useEffect(() => {
    if (prefillTarget && reachablePeople.length > 0) {
      const found = reachablePeople.find((p) => p.id === Number(prefillTarget));
      if (found) setSelectedTarget(found);
    }
  }, [prefillTarget, reachablePeople]);

  // Load intermediaries when target changes
  useEffect(() => {
    if (!selectedTarget) {
      setIntermediaries([]);
      setTotalDegrees(null);
      setSelectedInter(null);
      return;
    }
    setLoadingIntermediaries(true);
    setSelectedInter(null);
    api.getIntermediaries(selectedTarget.id).then((resp) => {
      setIntermediaries(resp.intermediaries);
      setTotalDegrees(resp.totalDegrees);
    }).catch(() => {}).finally(() => setLoadingIntermediaries(false));
  }, [selectedTarget]);

  const loadSent = useCallback(async () => {
    setLoadingSent(true);
    try { setSentRequests(await api.getSentIntroRequests()); }
    catch (err: any) { setError(err.message); }
    finally { setLoadingSent(false); }
  }, []);

  const loadInbox = useCallback(async () => {
    setLoadingInbox(true);
    try { setInboxRequests(await api.getInboxIntroRequests()); }
    catch (err: any) { setError(err.message); }
    finally { setLoadingInbox(false); }
  }, []);

  useEffect(() => {
    if (tab === "sent") loadSent();
    if (tab === "inbox") loadInbox();
  }, [tab, loadSent, loadInbox]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTarget || !selectedInter) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      await api.createIntroRequest({
        targetPersonId: selectedTarget.id,
        intermediaryPersonId: selectedInter.id,
        requestNote: requestNote || undefined,
      });
      setSuccess("Intro request sent!");
      setSelectedTarget(null);
      setSelectedInter(null);
      setRequestNote("");
      setTargetFilter("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRespond = async (action: "accept" | "decline") => {
    if (!respondingTo) return;
    setError("");
    try {
      await api.respondToIntroRequest(respondingTo.id, {
        action,
        responseNote: responseNote || undefined,
      });
      setRespondingTo(null);
      setResponseNote("");
      loadInbox();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCancel = async (id: number) => {
    setError("");
    try {
      await api.cancelIntroRequest(id);
      loadSent();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      pending: "#d29922",
      accepted: "#3fb950",
      declined: "#f85149",
      cancelled: "#8b949e",
    };
    return (
      <span style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 500,
        background: `${colors[status] || "#8b949e"}22`,
        color: colors[status] || "#8b949e",
        border: `1px solid ${colors[status] || "#8b949e"}44`,
      }}>
        {status}
      </span>
    );
  };

  const personLabel = (p?: { name: string; email?: string | null }) =>
    p ? `${p.name}${p.email ? ` (${p.email})` : ""}` : "Unknown";

  // Filtered target list
  const filteredTargets = reachablePeople.filter((p) => {
    if (p.locked) return false;
    if (!targetFilter) return true;
    const q = targetFilter.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.email?.toLowerCase().includes(q));
  }).slice(0, 50);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Introductions</h1>
        <p className="page-subtitle">Request warm intros through mutual connections</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {(["create", "sent", "inbox"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`btn ${tab === t ? "btn-primary" : ""}`}
            onClick={() => { setTab(t); setError(""); setSuccess(""); }}
          >
            {t === "create" ? "New Request" : t === "sent" ? "Sent" : "Inbox"}
          </button>
        ))}
      </div>

      {error && <div className="error-msg mb-4">{error}</div>}
      {success && (
        <div className="mb-4" style={{ background: "#1f3d2b", border: "1px solid #3fb950", color: "#3fb950", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}>
          {success}
        </div>
      )}

      {/* Create tab */}
      {tab === "create" && (
        <div className="card">
          <div className="card-header">Request a Warm Introduction</div>
          <form onSubmit={handleCreate}>
            {/* Target person */}
            <div className="form-group">
              <label className="form-label">Who do you want to meet?</label>
              {selectedTarget ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm">
                    {selectedTarget.name}
                    {selectedTarget.email && <span className="text-muted text-xs" style={{ marginLeft: 6 }}>{selectedTarget.email}</span>}
                  </span>
                  <span className="badge badge-friend" style={{ marginLeft: 4 }}>
                    {selectedTarget.degree} deg
                  </span>
                  <button type="button" className="btn text-xs" onClick={() => { setSelectedTarget(null); setTargetFilter(""); }}>Change</button>
                </div>
              ) : (
                <div style={{ position: "relative" }}>
                  <input
                    className="form-input"
                    value={targetFilter}
                    onChange={(e) => setTargetFilter(e.target.value)}
                    onFocus={() => setShowTargetDropdown(true)}
                    placeholder="Click to browse or type to filter..."
                  />
                  {showTargetDropdown && (
                    <div style={dropdownStyle}>
                      {filteredTargets.length === 0 ? (
                        <div style={{ padding: "8px 12px", color: "var(--text-muted)", fontSize: 12 }}>
                          {reachablePeople.length === 0 ? "No connections yet" : "No matches"}
                        </div>
                      ) : (
                        filteredTargets.map((p) => (
                          <div
                            key={p.id}
                            style={dropdownItemStyle}
                            onClick={() => {
                              setSelectedTarget(p);
                              setShowTargetDropdown(false);
                              setTargetFilter("");
                            }}
                          >
                            <div className="flex justify-between items-center">
                              <div>
                                <strong>{p.name}</strong>
                                {p.email && <span className="text-muted text-xs" style={{ marginLeft: 6 }}>{p.email}</span>}
                              </div>
                              <span className="text-xs" style={{
                                background: "var(--bg-tertiary)",
                                padding: "1px 6px",
                                borderRadius: 4,
                                color: "var(--text-secondary)",
                              }}>
                                {p.degree} deg
                              </span>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                  {/* Click-away handler */}
                  {showTargetDropdown && (
                    <div
                      style={{ position: "fixed", inset: 0, zIndex: 5 }}
                      onClick={() => setShowTargetDropdown(false)}
                    />
                  )}
                </div>
              )}
            </div>

            {/* Intermediary selection with traversal info */}
            {selectedTarget && (
              <div className="form-group">
                <label className="form-label">
                  Through whom?
                  {totalDegrees != null && (
                    <span className="text-muted text-xs" style={{ marginLeft: 8 }}>
                      ({totalDegrees} degree{totalDegrees !== 1 ? "s" : ""} away)
                    </span>
                  )}
                </label>
                {selectedInter ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm">
                      {selectedInter.name}
                      {selectedInter.email && <span className="text-muted text-xs" style={{ marginLeft: 6 }}>{selectedInter.email}</span>}
                    </span>
                    <span className="text-xs" style={{
                      background: "var(--bg-tertiary)",
                      padding: "1px 6px",
                      borderRadius: 4,
                      color: "var(--text-secondary)",
                    }}>
                      {selectedInter.totalHops} hops
                    </span>
                    <button type="button" className="btn text-xs" onClick={() => setSelectedInter(null)}>Change</button>
                  </div>
                ) : loadingIntermediaries ? (
                  <div className="text-muted text-sm">Loading intermediaries...</div>
                ) : intermediaries.length === 0 ? (
                  <div className="text-muted text-sm">
                    No intermediaries available. You need accepted connections that can reach this person.
                  </div>
                ) : (
                  <div style={{
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    maxHeight: 200,
                    overflowY: "auto",
                  }}>
                    {intermediaries.map((inter) => (
                      <div
                        key={inter.id}
                        style={{
                          padding: "8px 12px",
                          cursor: "pointer",
                          fontSize: 13,
                          borderBottom: "1px solid var(--border)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                        }}
                        onClick={() => setSelectedInter(inter)}
                      >
                        <div>
                          <strong>{inter.name}</strong>
                          {inter.email && <span className="text-muted text-xs" style={{ marginLeft: 6 }}>{inter.email}</span>}
                          {inter.company && <span className="text-secondary text-xs" style={{ marginLeft: 6 }}>at {inter.company}</span>}
                        </div>
                        <span style={{
                          background: inter.totalHops <= 2 ? "var(--success)" : "var(--warning)",
                          color: "#fff",
                          padding: "1px 6px",
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 500,
                          whiteSpace: "nowrap",
                        }}>
                          {inter.totalHops} hop{inter.totalHops !== 1 ? "s" : ""}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Note */}
            <div className="form-group">
              <label className="form-label">Note (optional)</label>
              <textarea
                className="form-textarea"
                value={requestNote}
                onChange={(e) => setRequestNote(e.target.value)}
                placeholder="Why you'd like to meet this person..."
                rows={3}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={!selectedTarget || !selectedInter || submitting}
            >
              {submitting ? "Sending..." : "Send Intro Request"}
            </button>
          </form>
        </div>
      )}

      {/* Sent tab */}
      {tab === "sent" && (
        loadingSent ? (
          <div className="text-secondary">Loading sent requests...</div>
        ) : sentRequests.length === 0 ? (
          <div className="card">
            <p className="text-secondary">No intro requests sent yet.</p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
                  <th style={thStyle}>Target</th>
                  <th style={thStyle}>Through</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Note</th>
                  <th style={thStyle}>Response</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {sentRequests.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={tdStyle}>{personLabel(r.targetPerson)}</td>
                    <td style={tdStyle}>{personLabel(r.intermediaryPerson)}</td>
                    <td style={tdStyle}>{statusBadge(r.status)}</td>
                    <td style={tdStyle} className="text-sm text-secondary">{r.requestNote || "\u2014"}</td>
                    <td style={tdStyle} className="text-sm text-secondary">{r.responseNote || "\u2014"}</td>
                    <td style={tdStyle}>
                      {r.status === "pending" && (
                        <button className="btn text-xs" style={{ padding: "2px 8px" }} onClick={() => handleCancel(r.id)}>
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Inbox tab */}
      {tab === "inbox" && (
        loadingInbox ? (
          <div className="text-secondary">Loading inbox...</div>
        ) : inboxRequests.length === 0 ? (
          <div className="card">
            <p className="text-secondary">No intro requests in your inbox.</p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-secondary)" }}>
                  <th style={thStyle}>From</th>
                  <th style={thStyle}>Wants to meet</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Their note</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {inboxRequests.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={tdStyle}>{personLabel(r.requesterPerson)}</td>
                    <td style={tdStyle}>{personLabel(r.targetPerson)}</td>
                    <td style={tdStyle}>{statusBadge(r.status)}</td>
                    <td style={tdStyle} className="text-sm text-secondary">{r.requestNote || "\u2014"}</td>
                    <td style={tdStyle}>
                      {r.status === "pending" && (
                        <div className="flex gap-2">
                          <button className="btn btn-primary text-xs" style={{ padding: "2px 8px" }} onClick={() => setRespondingTo(r)}>
                            Respond
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {/* Response modal */}
      {respondingTo && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
          onClick={() => setRespondingTo(null)}
        >
          <div className="card" style={{ width: 420, maxHeight: "80vh", overflow: "auto" }} onClick={(e) => e.stopPropagation()}>
            <div className="card-header">Respond to Intro Request</div>
            <p className="text-sm text-secondary mb-2">
              <strong>{respondingTo.requesterPerson?.name}</strong> would like you to introduce them to <strong>{respondingTo.targetPerson?.name}</strong>.
            </p>
            {respondingTo.requestNote && (
              <div style={{ background: "var(--bg-secondary)", padding: "8px 12px", borderRadius: 6, fontSize: 13, marginBottom: 12 }}>
                "{respondingTo.requestNote}"
              </div>
            )}
            <div className="form-group">
              <label className="form-label">Your response note (optional)</label>
              <textarea
                className="form-textarea"
                value={responseNote}
                onChange={(e) => setResponseNote(e.target.value)}
                placeholder="Add a note..."
                rows={2}
              />
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary" onClick={() => handleRespond("accept")}>Accept</button>
              <button className="btn" style={{ color: "var(--danger)" }} onClick={() => handleRespond("decline")}>Decline</button>
              <button className="btn" onClick={() => setRespondingTo(null)}>Close</button>
            </div>
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
  color: "var(--text-secondary)",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 13,
  whiteSpace: "nowrap",
};

const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  right: 0,
  background: "var(--bg-secondary)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  maxHeight: 240,
  overflowY: "auto",
  zIndex: 10,
};

const dropdownItemStyle: React.CSSProperties = {
  padding: "8px 12px",
  cursor: "pointer",
  fontSize: 13,
  borderBottom: "1px solid var(--border)",
};
