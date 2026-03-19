import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import type {
  IntroRequest,
  IntroRequestStatus,
  PathResult,
  Person,
} from "@connex/shared";
import { api } from "../api/client";
import { useAuth } from "../api/auth-context";

const STATUS_CLASS: Record<IntroRequestStatus, string> = {
  pending: "pending",
  accepted: "reg",
  declined: "locked",
  cancelled: "",
};

export default function IntroductionsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();

  const [people, setPeople] = useState<Person[]>([]);
  const [sent, setSent] = useState<IntroRequest[]>([]);
  const [inbox, setInbox] = useState<IntroRequest[]>([]);

  const [target, setTarget] = useState<number>(
    Number(params.get("target")) || 0,
  );
  const [intermediary, setIntermediary] = useState<number>(0);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [path, setPath] = useState<PathResult | null>(null);
  const [responseNotes, setResponseNotes] = useState<Record<number, string>>({});

  async function load() {
    const [ppl, s, i] = await Promise.all([
      api.listPeople(""),
      api.listIntroSent(),
      api.listIntroInbox(),
    ]);
    setPeople(ppl);
    setSent(s);
    setInbox(i);
  }
  useEffect(() => {
    load();
  }, []);

  // When target changes, fetch the shortest path so we can suggest
  // valid intermediaries.
  useEffect(() => {
    if (!target) {
      setPath(null);
      setIntermediary(0);
      return;
    }
    api
      .path(target)
      .then((p) => {
        setPath(p);
        if (p.found && p.nodes.length >= 3) {
          // First hop is the most natural suggestion.
          setIntermediary(p.nodes[1].personId);
        } else {
          setIntermediary(0);
        }
      })
      .catch(() => setPath(null));
  }, [target]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.createIntroRequest({
        targetPersonId: target,
        intermediaryPersonId: intermediary,
        note: note || undefined,
      });
      setNote("");
      if (params.get("target")) setParams({}, { replace: true });
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function respond(id: number, action: "accept" | "decline") {
    await api.respondIntroRequest(id, {
      action,
      note: responseNotes[id] || undefined,
    });
    await load();
  }

  async function cancel(id: number) {
    await api.cancelIntroRequest(id);
    await load();
  }

  if (!user) return null;

  // Candidate intermediaries: interior nodes of the shortest path (exclude
  // self and target). If path is locked, interior nodes are redacted and
  // creation will fail server-side anyway, so skip suggesting them.
  const suggested =
    path?.found && !path.locked
      ? path.nodes.slice(1, -1).map((n) => ({
          id: n.personId,
          name: n.name,
        }))
      : [];

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="panel">
        <h2>Request intro</h2>
        <p className="hint">
          Ask someone on your shortest path to introduce you.
        </p>
        <form onSubmit={submit}>
          <div className="row">
            <div className="field">
              <label>Target</label>
              <select
                value={target}
                onChange={(e) => setTarget(Number(e.target.value))}
              >
                <option value={0}>Choose…</option>
                {people
                  .filter((p) => p.id !== user.personId)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="field">
              <label>Intermediary</label>
              <select
                value={intermediary}
                onChange={(e) => setIntermediary(Number(e.target.value))}
              >
                <option value={0}>Choose…</option>
                {suggested.length > 0 && (
                  <optgroup label="On your shortest path">
                    {suggested.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                <optgroup label="Everyone">
                  {people
                    .filter((p) => p.id !== user.personId && p.id !== target)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </optgroup>
              </select>
            </div>
          </div>
          {target > 0 && path && (
            <p className="hint">
              {path.found
                ? path.length === 1
                  ? "You are already directly connected — an intro may not be necessary."
                  : `Shortest path: ${path.length} hops${path.locked ? " (locked on your plan)" : ""}`
                : "No path to this person in the current graph."}
            </p>
          )}
          <div className="field">
            <label>Note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Why you'd like an intro…"
            />
          </div>
          {err && <div className="error">{err}</div>}
          <button type="submit" disabled={busy || !target || !intermediary}>
            {busy ? "Sending…" : "Send request"}
          </button>
        </form>
      </div>

      <div className="panel">
        <h2>Inbox</h2>
        <p className="hint">Intro requests routed through you.</p>
        {inbox.length === 0 && <div className="empty">No incoming requests.</div>}
        {inbox.map((r) => (
          <div key={r.id} className="list-item">
            <div className="title">
              {r.requester.name} → {r.target.name}{" "}
              <span className={`badge ${STATUS_CLASS[r.status]}`}>
                {r.status}
              </span>
            </div>
            <div className="sub">
              Asked {new Date(r.createdAt).toLocaleString()}
              {r.requestNote && ` · "${r.requestNote}"`}
            </div>
            {r.status === "pending" ? (
              <>
                <div className="field" style={{ marginTop: 8 }}>
                  <input
                    placeholder="Response note (optional)"
                    value={responseNotes[r.id] ?? ""}
                    onChange={(e) =>
                      setResponseNotes((m) => ({ ...m, [r.id]: e.target.value }))
                    }
                    maxLength={1000}
                  />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={() => respond(r.id, "accept")}>
                    Accept
                  </button>
                  <button
                    className="secondary"
                    onClick={() => respond(r.id, "decline")}
                  >
                    Decline
                  </button>
                </div>
              </>
            ) : (
              r.responseNote && (
                <div className="sub">Response: "{r.responseNote}"</div>
              )
            )}
          </div>
        ))}
      </div>

      <div className="panel">
        <h2>Sent</h2>
        {sent.length === 0 && <div className="empty">No sent requests.</div>}
        {sent.map((r) => (
          <div key={r.id} className="list-item">
            <div className="title">
              To {r.target.name} via {r.intermediary.name}{" "}
              <span className={`badge ${STATUS_CLASS[r.status]}`}>
                {r.status}
              </span>
            </div>
            <div className="sub">
              {new Date(r.createdAt).toLocaleString()}
              {r.requestNote && ` · "${r.requestNote}"`}
              {r.respondedAt &&
                ` · Responded ${new Date(r.respondedAt).toLocaleDateString()}`}
              {r.responseNote && ` · "${r.responseNote}"`}
            </div>
            {r.status === "pending" && (
              <button
                className="secondary"
                style={{ marginTop: 8 }}
                onClick={() => cancel(r.id)}
              >
                Cancel
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
