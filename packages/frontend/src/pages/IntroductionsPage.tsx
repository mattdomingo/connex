import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import type { ApiIntroRequest, IntroCandidate } from "@connex/shared";
import { useAuth } from "../hooks/useAuth.js";
import * as api from "../api/client.js";

type Tab = "create" | "sent" | "inbox";

export function IntroductionsPage() {
  const { person } = useAuth();
  const [searchParams] = useSearchParams();
  const initialTab = (searchParams.get("tab") as Tab) || "create";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // ── Create state ──────────────────────────────────────────────────────────
  const [targets, setTargets] = useState<IntroCandidate[]>([]);
  const [targetsLoading, setTargetsLoading] = useState(true);
  const [selectedTarget, setSelectedTarget] = useState<IntroCandidate | null>(null);
  const [targetDegree, setTargetDegree] = useState<number>(-1);
  // The chain of intermediary personIds selected so far (excludes requester & target).
  const [chain, setChain] = useState<IntroCandidate[]>([]);
  // Options for the *next* intermediary slot.
  const [nextOptions, setNextOptions] = useState<IntroCandidate[]>([]);
  const [nextLoading, setNextLoading] = useState(false);
  const [requestNote, setRequestNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ── Sent / Inbox ──────────────────────────────────────────────────────────
  const [sentRequests, setSentRequests] = useState<ApiIntroRequest[]>([]);
  const [inboxRequests, setInboxRequests] = useState<ApiIntroRequest[]>([]);
  const [loadingSent, setLoadingSent] = useState(false);
  const [loadingInbox, setLoadingInbox] = useState(false);

  // Response modal
  const [respondingTo, setRespondingTo] = useState<ApiIntroRequest | null>(null);
  const [responseNote, setResponseNote] = useState("");

  // Load targets once the create tab is active.
  useEffect(() => {
    if (tab !== "create") return;
    setTargetsLoading(true);
    api.getIntroTargets()
      .then((res) => setTargets(res.candidates))
      .catch((e: any) => setError(e.message))
      .finally(() => setTargetsLoading(false));
  }, [tab]);

  // When target or chain changes, load next-hop intermediary options.
  useEffect(() => {
    if (!selectedTarget) { setNextOptions([]); return; }
    const chainIds = chain.map((c) => c.personId);
    setNextLoading(true);
    api.getIntroIntermediaries(selectedTarget.personId, chainIds)
      .then((res) => {
        setTargetDegree(res.targetDegree);
        setNextOptions(res.candidates);
      })
      .catch((e: any) => setError(e.message))
      .finally(() => setNextLoading(false));
  }, [selectedTarget, chain]);

  const resetChain = () => {
    setChain([]);
    setNextOptions([]);
    setTargetDegree(-1);
  };

  const handleSelectTarget = (c: IntroCandidate) => {
    if (c.locked) return;
    setSelectedTarget(c);
    resetChain();
  };

  const handleSelectInter = (c: IntroCandidate) => {
    if (c.locked) return;
    setChain((prev) => [...prev, c]);
  };

  const handleRemoveFrom = (idx: number) => {
    setChain((prev) => prev.slice(0, idx));
  };

  // The chain is complete when the last selected intermediary is one hop from
  // the target — i.e., the most recent option picked had minHops === 1, so
  // the remaining distance after adding it becomes 0.
  const chainComplete =
    chain.length > 0 && chain[chain.length - 1].minHops === 1;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTarget || chain.length === 0 || !chainComplete) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      // The backend models a single intermediary on a shortest path. The first
      // hop of the chain is who the *requester* asks — deeper hops are shown
      // here for the user's planning, but the formal request only needs the
      // first intermediary.
      await api.createIntroRequest({
        targetPersonId: selectedTarget.personId,
        intermediaryPersonId: chain[0].personId,
        requestNote: requestNote || undefined,
      });
      setSuccess("Intro request sent!");
      setSelectedTarget(null);
      resetChain();
      setRequestNote("");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

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

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Introductions</h1>
        <p className="page-subtitle">Request warm intros through mutual connections</p>
      </div>

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
      {success && <div className="success-msg mb-4">{success}</div>}

      {tab === "create" && (
        <div className="card">
          <div className="card-header">Request a Warm Introduction</div>
          <form onSubmit={handleCreate}>
            {/* Target selector */}
            <div className="form-group">
              <label className="form-label">Who do you want to meet?</label>
              {selectedTarget ? (
                <div className="chain-pill chain-target">
                  <span>{selectedTarget.name}</span>
                  <span className="chain-hop">
                    {selectedTarget.minHops} {selectedTarget.minHops === 1 ? "hop" : "hops"}
                  </span>
                  <button
                    type="button"
                    className="chain-clear"
                    onClick={() => { setSelectedTarget(null); resetChain(); }}
                  >×</button>
                </div>
              ) : (
                <TargetPicker
                  candidates={targets}
                  loading={targetsLoading}
                  myPersonId={person?.id ?? -1}
                  onSelect={handleSelectTarget}
                />
              )}
            </div>

            {/* Chain builder */}
            {selectedTarget && (
              <div className="form-group">
                <label className="form-label">
                  Through whom?
                  {targetDegree > 0 && (
                    <span className="text-xs text-muted" style={{ marginLeft: 6 }}>
                      (min {targetDegree}-hop path)
                    </span>
                  )}
                </label>

                {/* Already-selected hops */}
                {chain.length > 0 && (
                  <div className="flex gap-2 mb-2" style={{ flexWrap: "wrap" }}>
                    {chain.map((c, i) => (
                      <div key={c.personId} className="chain-pill">
                        <span className="chain-ord">{i + 1}.</span>
                        <span>{c.name}</span>
                        <span className="chain-hop">→ {c.minHops - 1} more</span>
                        <button
                          type="button"
                          className="chain-clear"
                          title="Remove this and all following hops"
                          onClick={() => handleRemoveFrom(i)}
                        >×</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Next hop selector */}
                {!chainComplete && (
                  <IntermediaryPicker
                    candidates={nextOptions}
                    loading={nextLoading}
                    stepLabel={
                      chain.length === 0
                        ? "First intermediary (your direct connection)"
                        : `Hop ${chain.length + 1}`
                    }
                    onSelect={handleSelectInter}
                    emptyHint={
                      targetDegree < 0
                        ? "Target unreachable."
                        : "No intermediaries within your plan's visibility. Upgrade to unlock longer chains."
                    }
                  />
                )}

                {chainComplete && (
                  <div className="text-xs text-success">
                    ✓ Chain complete — {chain[chain.length - 1].name} knows {selectedTarget.name} directly.
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
                placeholder="Why you'd like to meet this person…"
                rows={3}
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={!selectedTarget || !chainComplete || submitting}
            >
              {submitting ? "Sending…" : "Send Intro Request"}
            </button>
          </form>
        </div>
      )}

      {tab === "sent" && (
        loadingSent ? (
          <div className="text-secondary">Loading sent requests…</div>
        ) : sentRequests.length === 0 ? (
          <div className="card text-secondary">No intro requests sent yet.</div>
        ) : (
          <RequestTable
            requests={sentRequests}
            mode="sent"
            onCancel={handleCancel}
          />
        )
      )}

      {tab === "inbox" && (
        loadingInbox ? (
          <div className="text-secondary">Loading inbox…</div>
        ) : inboxRequests.length === 0 ? (
          <div className="card text-secondary">No intro requests in your inbox.</div>
        ) : (
          <RequestTable
            requests={inboxRequests}
            mode="inbox"
            onRespond={(r) => setRespondingTo(r)}
          />
        )
      )}

      {respondingTo && (
        <div
          className="modal-overlay"
          onClick={() => setRespondingTo(null)}
        >
          <div className="card" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="card-header">Respond to Intro Request</div>
            <p className="text-sm text-secondary mb-2">
              <strong>{respondingTo.requesterPerson?.name}</strong> would like you to introduce them to <strong>{respondingTo.targetPerson?.name}</strong>.
            </p>
            {respondingTo.requestNote && (
              <div className="note-quote">"{respondingTo.requestNote}"</div>
            )}
            <div className="form-group">
              <label className="form-label">Your response note (optional)</label>
              <textarea
                className="form-textarea"
                value={responseNote}
                onChange={(e) => setResponseNote(e.target.value)}
                rows={2}
              />
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary" onClick={() => handleRespond("accept")}>Accept</button>
              <button className="btn btn-danger" onClick={() => handleRespond("decline")}>Decline</button>
              <button className="btn" onClick={() => setRespondingTo(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function HopBadge({ hops, locked }: { hops: number; locked?: boolean }) {
  return (
    <span className={`hop-badge${locked ? " hop-locked" : ""}`} title="Minimum hops to target">
      {locked ? "🔒 " : ""}{hops}
    </span>
  );
}

function TargetPicker({
  candidates, loading, myPersonId, onSelect,
}: {
  candidates: IntroCandidate[];
  loading: boolean;
  myPersonId: number;
  onSelect: (c: IntroCandidate) => void;
}) {
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = candidates.filter(
    (c) => c.personId !== myPersonId &&
      c.minHops >= 2 && // no intro needed for direct (1-hop) contacts
      (!filter ||
        c.name.toLowerCase().includes(filter.toLowerCase()) ||
        c.email?.toLowerCase().includes(filter.toLowerCase()))
  );

  return (
    <div style={{ position: "relative" }}>
      <input
        className="form-input"
        placeholder="Click or type to see reachable people…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <div className="picker-dropdown">
          {loading ? (
            <div className="picker-item text-muted">Loading network…</div>
          ) : filtered.length === 0 ? (
            <div className="picker-item text-muted">No reachable targets.</div>
          ) : (
            filtered.map((c) => (
              <div
                key={c.personId}
                className={`picker-item${c.locked ? " locked" : ""}`}
                onMouseDown={(e) => { e.preventDefault(); if (!c.locked) onSelect(c); }}
              >
                <div className="flex-1">
                  <strong>{c.locked ? "Locked contact" : c.name}</strong>
                  {!c.locked && c.email && (
                    <span className="text-muted text-xs" style={{ marginLeft: 6 }}>{c.email}</span>
                  )}
                  {!c.locked && c.company && (
                    <span className="text-muted text-xs" style={{ marginLeft: 6 }}>· {c.company}</span>
                  )}
                </div>
                <HopBadge hops={c.minHops} locked={c.locked} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function IntermediaryPicker({
  candidates, loading, stepLabel, onSelect, emptyHint,
}: {
  candidates: IntroCandidate[];
  loading: boolean;
  stepLabel: string;
  onSelect: (c: IntroCandidate) => void;
  emptyHint: string;
}) {
  return (
    <div className="picker-box">
      <div className="text-xs text-muted mb-2">{stepLabel}</div>
      {loading ? (
        <div className="text-xs text-muted">Finding connectors…</div>
      ) : candidates.length === 0 ? (
        <div className="text-xs text-warning">{emptyHint}</div>
      ) : (
        <div className="picker-grid">
          {candidates.map((c) => (
            <button
              key={c.personId}
              type="button"
              className={`picker-chip${c.locked ? " locked" : ""}`}
              onClick={() => onSelect(c)}
              disabled={c.locked}
            >
              <span>{c.name}</span>
              <HopBadge hops={c.minHops} locked={c.locked} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RequestTable({
  requests, mode, onCancel, onRespond,
}: {
  requests: ApiIntroRequest[];
  mode: "sent" | "inbox";
  onCancel?: (id: number) => void;
  onRespond?: (r: ApiIntroRequest) => void;
}) {
  const personLabel = (p?: { name: string; email?: string | null }) =>
    p ? p.name : "—";

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg-tertiary)" }}>
            <th style={th}>{mode === "sent" ? "Target" : "From"}</th>
            <th style={th}>{mode === "sent" ? "Through" : "Wants to meet"}</th>
            <th style={th}>Status</th>
            <th style={th}>Note</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={td}>{personLabel(mode === "sent" ? r.targetPerson : r.requesterPerson)}</td>
              <td style={td}>{personLabel(mode === "sent" ? r.intermediaryPerson : r.targetPerson)}</td>
              <td style={td}><StatusBadge status={r.status} /></td>
              <td style={td} className="text-sm text-secondary">{r.requestNote || "—"}</td>
              <td style={td}>
                {r.status === "pending" && mode === "sent" && onCancel && (
                  <button className="btn text-xs" onClick={() => onCancel(r.id)}>Cancel</button>
                )}
                {r.status === "pending" && mode === "inbox" && onRespond && (
                  <button className="btn btn-primary text-xs" onClick={() => onRespond(r)}>Respond</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    pending: "badge-pending",
    accepted: "badge-accepted",
    declined: "badge-rejected",
    cancelled: "badge-other",
  };
  return <span className={`badge ${cls[status] || "badge-other"}`}>{status}</span>;
}

const th: React.CSSProperties = { padding: "10px 12px", textAlign: "left", fontSize: 12, fontWeight: 500, color: "var(--text-secondary)" };
const td: React.CSSProperties = { padding: "10px 12px", fontSize: 13 };
