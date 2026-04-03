import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../hooks/useAuth.js";
import * as api from "../api/client.js";
import type { GoogleAccountStatus, GmailSyncRun, GmailSyncFeedItem } from "@connex/shared";

export function ProfilePage() {
  const { person, refreshProfile } = useAuth();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(person?.name ?? "");
  const [bio, setBio] = useState(person?.bio ?? "");
  const [company, setCompany] = useState(person?.company ?? "");
  const [school, setSchool] = useState(person?.school ?? "");
  const [location, setLocation] = useState(person?.location ?? "");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Google/Gmail state
  const [googleStatus, setGoogleStatus] = useState<GoogleAccountStatus | null>(null);
  const [syncStatus, setSyncStatus] = useState<GmailSyncRun | { status: "never_synced" } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const feedPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [feedItems, setFeedItems] = useState<GmailSyncFeedItem[]>([]);
  const feedSeqRef = useRef<number>(0);

  const pollFeed = useCallback(async () => {
    try {
      const items = await api.getGmailSyncFeed(feedSeqRef.current);
      if (items.length > 0) {
        setFeedItems((prev) => {
          const merged = [...prev, ...items];
          return merged.slice(-50); // keep last 50
        });
        feedSeqRef.current = items[items.length - 1].seq;
      }
    } catch {
      // ignore feed poll errors
    }
  }, []);

  const pollSyncStatus = useCallback(async () => {
    try {
      const ss = await api.getGmailSyncStatus();
      setSyncStatus(ss);
      if ("status" in ss && ss.status !== "running") {
        // Sync finished — stop polling
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
        if (feedPollRef.current) {
          clearInterval(feedPollRef.current);
          feedPollRef.current = null;
        }
        setSyncing(false);
      }
    } catch {
      // ignore poll errors
    }
  }, []);

  useEffect(() => {
    loadGoogleStatus();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (feedPollRef.current) clearInterval(feedPollRef.current);
    };
  }, []);

  const loadGoogleStatus = async () => {
    try {
      const [gs, ss] = await Promise.all([
        api.getGoogleStatus(),
        api.getGmailSyncStatus(),
      ]);
      setGoogleStatus(gs);
      setSyncStatus(ss);
      // If sync is currently running, start polling
      if ("status" in ss && ss.status === "running") {
        setSyncing(true);
        pollRef.current = setInterval(pollSyncStatus, 3000);
        feedPollRef.current = setInterval(pollFeed, 1500);
      }
    } catch {
      // Google not configured or not connected
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess(false);
    try {
      await api.updateMyProfile({
        name,
        bio: bio || null,
        company: company || null,
        school: school || null,
        location: location || null,
      });
      await refreshProfile();
      setSuccess(true);
      setEditing(false);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleConnectGoogle = () => {
    window.location.href = "/api/integrations/google/connect/start";
  };

  const handleDisconnectGoogle = async () => {
    try {
      await api.disconnectGoogle();
      setGoogleStatus({ connected: false, email: null, scopes: null, connectedAt: null });
      setSyncStatus({ status: "never_synced" });
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError("");
    setFeedItems([]);
    feedSeqRef.current = 0;
    try {
      const result = await api.triggerGmailSync();
      setSyncStatus(result);
      // Start polling if sync is running
      if (result.status === "running") {
        pollRef.current = setInterval(pollSyncStatus, 3000);
        feedPollRef.current = setInterval(pollFeed, 1500);
      }
    } catch (err: any) {
      setError(err.message);
      setSyncing(false);
    }
  };

  if (!person) return null;

  const syncRun = syncStatus && "id" in syncStatus ? syncStatus as GmailSyncRun : null;

  return (
    <div>
      <div className="page-header flex justify-between items-center">
        <div>
          <h1 className="page-title">Profile</h1>
          <p className="page-subtitle">Your public profile visible to connections</p>
        </div>
        {!editing && (
          <button className="btn" onClick={() => { setEditing(true); setSuccess(false); }}>
            Edit Profile
          </button>
        )}
      </div>

      {error && <div className="error-msg mb-4">{error}</div>}
      {success && (
        <div className="mb-4" style={{ background: "#1f3d2b", border: "1px solid #3fb950", color: "#3fb950", padding: "8px 12px", borderRadius: 6, fontSize: 13 }}>
          Profile updated successfully
        </div>
      )}

      <div className="card">
        {editing ? (
          <form onSubmit={handleSave}>
            <div className="form-group">
              <label className="form-label">Name</label>
              <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Bio</label>
              <textarea className="form-textarea" value={bio} onChange={(e) => setBio(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Company</label>
              <input className="form-input" value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">School</label>
              <input className="form-input" value={school} onChange={(e) => setSchool(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Location</label>
              <input className="form-input" value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary">Save</button>
              <button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <dl className="person-detail">
            <dt>Name</dt>
            <dd>{person.name}</dd>
            <dt>Email</dt>
            <dd>{person.email}</dd>
            <dt>Bio</dt>
            <dd>{person.bio || <span className="text-muted">Not set</span>}</dd>
            <dt>Company</dt>
            <dd>{person.company || <span className="text-muted">Not set</span>}</dd>
            <dt>School</dt>
            <dd>{person.school || <span className="text-muted">Not set</span>}</dd>
            <dt>Location</dt>
            <dd>{person.location || <span className="text-muted">Not set</span>}</dd>
          </dl>
        )}
      </div>

      {/* Google Account & Gmail Sync */}
      {!googleLoading && (
        <div className="card mt-4">
          <div className="card-header">Google Account & Gmail Sync</div>

          {googleStatus?.connected ? (
            <>
              <div className="flex justify-between items-center mb-4">
                <div>
                  <div className="text-sm">
                    Connected as <strong>{googleStatus.email}</strong>
                  </div>
                  {googleStatus.connectedAt && (
                    <div className="text-xs text-muted mt-1">
                      Connected {new Date(googleStatus.connectedAt).toLocaleDateString()}
                    </div>
                  )}
                </div>
                <button
                  className="btn text-xs"
                  onClick={handleDisconnectGoogle}
                  style={{ color: "#f85149" }}
                  disabled={syncing}
                >
                  Disconnect
                </button>
              </div>

              <div style={{ borderTop: "1px solid #30363d", paddingTop: 12 }}>
                <div className="flex justify-between items-center">
                  <div style={{ flex: 1 }}>
                    <div className="text-sm font-medium">Gmail Sync</div>
                    <div className="text-xs text-muted mt-1">
                      {syncing ? (
                        <span style={{ color: "#d29922" }}>
                          Syncing inbox metadata...
                          {syncRun && syncRun.messagesScanned > 0 && (
                            <> ({syncRun.messagesScanned} scanned)</>
                          )}
                        </span>
                      ) : syncRun ? (
                        syncRun.status === "success" ? (
                          <span style={{ color: "#3fb950" }}>
                            Last sync: {syncRun.messagesProcessed} interactions from {syncRun.messagesScanned} messages
                            {syncRun.finishedAt && <> · {new Date(syncRun.finishedAt).toLocaleString()}</>}
                          </span>
                        ) : syncRun.status === "failed" ? (
                          <span style={{ color: "#f85149" }}>
                            Last sync failed: {syncRun.errorMessage || "Unknown error"}
                          </span>
                        ) : null
                      ) : (
                        "Never synced — click Sync Now to discover your top connections"
                      )}
                    </div>
                  </div>
                  <button
                    className="btn btn-primary text-sm"
                    onClick={handleSync}
                    disabled={syncing}
                    style={{ minWidth: 100 }}
                  >
                    {syncing ? (
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="spinner" />
                        Syncing...
                      </span>
                    ) : "Sync Now"}
                  </button>
                </div>

                {/* Progress bar while syncing */}
                {syncing && (
                  <div style={{ marginTop: 8, height: 3, background: "#21262d", borderRadius: 2, overflow: "hidden" }}>
                    <div style={{
                      height: "100%",
                      background: "#d29922",
                      borderRadius: 2,
                      animation: "indeterminate 1.5s ease-in-out infinite",
                      width: "30%",
                    }} />
                  </div>
                )}

                {/* Live feed of sync activity */}
                {feedItems.length > 0 && (
                  <div style={{ marginTop: 12, borderTop: "1px solid #30363d", paddingTop: 8 }}>
                    <div className="text-xs text-muted mb-2">Live sync feed</div>
                    <div style={{
                      maxHeight: 180,
                      overflowY: "auto",
                      fontSize: 12,
                      fontFamily: "monospace",
                    }}>
                      {[...feedItems].reverse().slice(0, 30).map((item) => (
                        <div key={item.seq} style={{
                          padding: "3px 0",
                          borderBottom: "1px solid #21262d",
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                        }}>
                          <span style={{
                            color: item.direction === "sent" ? "#58a6ff" : "#3fb950",
                            fontWeight: 500,
                            minWidth: 14,
                            textAlign: "center",
                          }}>
                            {item.direction === "sent" ? "\u2191" : "\u2193"}
                          </span>
                          <span style={{ color: "#e1e4e8" }}>
                            {item.counterpartyName || item.counterpartyEmail}
                          </span>
                          <span className="text-muted" style={{ fontSize: 10, marginLeft: "auto" }}>
                            {new Date(item.occurredAt).toLocaleDateString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div>
              <p className="text-sm text-secondary mb-3">
                Connect your Google account to automatically discover and rank your strongest relationships based on email interaction patterns.
              </p>
              <button className="btn btn-primary" onClick={handleConnectGoogle}>
                Connect Google Account
              </button>
            </div>
          )}
        </div>
      )}

      <style>{`
        .spinner {
          display: inline-block;
          width: 12px;
          height: 12px;
          border: 2px solid rgba(255,255,255,0.3);
          border-top-color: #fff;
          border-radius: 50%;
          animation: spin 0.6s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes indeterminate {
          0% { margin-left: 0; width: 30%; }
          50% { margin-left: 40%; width: 40%; }
          100% { margin-left: 70%; width: 30%; }
        }
      `}</style>
    </div>
  );
}
