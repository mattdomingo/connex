import { FormEvent, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, GmailStatus, GmailSyncResult } from "../api/client";
import { useAuth } from "../api/auth-context";

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [company, setCompany] = useState("");
  const [school, setSchool] = useState("");
  const [location, setLocation] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.person.name);
      setBio(user.person.bio ?? "");
      setCompany(user.person.company ?? "");
      setSchool(user.person.school ?? "");
      setLocation(user.person.location ?? "");
    }
  }, [user]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSaved(false);
    await api.updateProfile({
      name,
      bio: bio || null,
      company: company || null,
      school: school || null,
      location: location || null,
    });
    await refresh();
    setSaved(true);
    setBusy(false);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!user) return null;

  return (
    <div style={{ maxWidth: 600 }}>
      <div className="panel">
        <h2>Your profile</h2>
        <p className="hint">Email: {user.email} · Tier: {user.tier}</p>
        <form onSubmit={submit}>
          <div className="field">
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field">
            <label>Bio</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              maxLength={500}
            />
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
          </div>
          <div className="field">
            <label>Location</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} />
          </div>
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          {saved && <span style={{ marginLeft: 12, color: "var(--ok)" }}>Saved</span>}
        </form>
      </div>

      <GmailPanel />
    </div>
  );
}

function GmailPanel() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const gmailParam = params.get("gmail");

  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<GmailSyncResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const handled = useRef(false);

  async function loadStatus() {
    try {
      setStatus(await api.getGmailStatus());
    } catch {
      setStatus({ connected: false });
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  // Handle ?gmail=connect → kick off OAuth redirect.
  // Handle ?gmail=connected → auto-sync once, then go to /graph.
  useEffect(() => {
    if (handled.current) return;
    if (gmailParam === "connect") {
      handled.current = true;
      api.connectGmail();
      return;
    }
    if (gmailParam === "connected") {
      handled.current = true;
      (async () => {
        setSyncing(true);
        setErr(null);
        try {
          const res = await api.syncGmail();
          setLastSync(res);
          nav("/graph", { replace: true });
        } catch (e) {
          setErr((e as Error).message);
          setParams({}, { replace: true });
          await loadStatus();
        } finally {
          setSyncing(false);
        }
      })();
    }
  }, [gmailParam, nav, setParams]);

  async function syncNow() {
    setSyncing(true);
    setErr(null);
    try {
      const res = await api.syncGmail();
      setLastSync(res);
      await loadStatus();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSyncing(false);
    }
  }

  async function revoke() {
    if (!confirm("Disconnect Gmail and delete all Gmail-derived data?")) return;
    await api.revokeGmail();
    setLastSync(null);
    await loadStatus();
  }

  return (
    <div className="panel" style={{ marginTop: 24 }}>
      <h2>Gmail</h2>
      <p className="hint">
        Connex reads only From / To / Cc / Date headers — never subjects or
        bodies — to infer who you know.
      </p>

      {gmailParam === "connect" && (
        <p className="hint">Redirecting to Google…</p>
      )}

      {!status ? (
        <p className="hint">Loading…</p>
      ) : !status.connected ? (
        <button onClick={() => api.connectGmail()} disabled={syncing}>
          Connect Gmail
        </button>
      ) : (
        <>
          <p className="hint">
            Connected: <strong>{status.gmailAddress}</strong>
            {status.lastSyncedAt && (
              <> · Last sync {new Date(status.lastSyncedAt).toLocaleString()}</>
            )}
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={syncNow} disabled={syncing}>
              {syncing ? "Syncing…" : "Sync now"}
            </button>
            <button className="secondary" onClick={revoke} disabled={syncing}>
              Revoke
            </button>
          </div>
          {lastSync && (
            <p className="hint" style={{ marginTop: 8 }}>
              Fetched {lastSync.fetched} · {lastSync.newMetadata} new ·
              {" "}{lastSync.relationshipEdges} ties ·
              {" "}{lastSync.connectionsBridged} bridged
            </p>
          )}
        </>
      )}

      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}
