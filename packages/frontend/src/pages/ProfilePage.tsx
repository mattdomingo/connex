import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../hooks/useAuth.js";
import { useSyncStatus } from "../hooks/useSyncStatus.js";
import * as api from "../api/client.js";
import type { GoogleAccountStatus, SyncFeedItem } from "@connex/shared";

export function ProfilePage() {
  const { person, refreshProfile } = useAuth();
  const { run: syncRun, isSyncing, triggerSync } = useSyncStatus();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(person?.name ?? "");
  const [bio, setBio] = useState(person?.bio ?? "");
  const [company, setCompany] = useState(person?.company ?? "");
  const [school, setSchool] = useState(person?.school ?? "");
  const [location, setLocation] = useState(person?.location ?? "");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const [googleStatus, setGoogleStatus] = useState<GoogleAccountStatus | null>(null);
  const [googleLoading, setGoogleLoading] = useState(true);

  // Live sync feed
  const [feedItems, setFeedItems] = useState<SyncFeedItem[]>([]);
  const lastFeedId = useRef<number>(0);
  const feedPoll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadGoogleStatus();
    return () => {
      if (feedPoll.current) clearInterval(feedPoll.current);
    };
  }, []);

  // Poll feed while a sync is running
  useEffect(() => {
    const stop = () => {
      if (feedPoll.current) {
        clearInterval(feedPoll.current);
        feedPoll.current = null;
      }
    };

    const pull = async () => {
      try {
        const res = await api.getGmailSyncFeed(lastFeedId.current || undefined, 50);
        if (res.items.length) {
          lastFeedId.current = Math.max(
            lastFeedId.current,
            ...res.items.map((i) => i.id),
          );
          setFeedItems((prev) => [...res.items, ...prev].slice(0, 200));
        }
      } catch {
        /* ignore */
      }
    };

    if (isSyncing) {
      // Reset feed on a fresh run
      setFeedItems([]);
      lastFeedId.current = 0;
      pull();
      feedPoll.current = setInterval(pull, 1500);
    } else {
      // One final pull to catch the tail after completion.
      pull();
      stop();
    }

    return stop;
  }, [isSyncing]);

  const loadGoogleStatus = async () => {
    try {
      const gs = await api.getGoogleStatus();
      setGoogleStatus(gs);
    } catch {
      /* not configured */
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
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleSync = async () => {
    setError("");
    try {
      await triggerSync();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (!person) return null;

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
        <div className="mb-4 success-msg">Profile updated successfully</div>
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
                  style={{ color: "var(--danger)" }}
                  disabled={isSyncing}
                >
                  Disconnect
                </button>
              </div>

              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <div className="flex justify-between items-center">
                  <div style={{ flex: 1 }}>
                    <div className="text-sm font-medium">Gmail Sync</div>
                    <div className="text-xs text-muted mt-1">
                      {isSyncing ? (
                        <span style={{ color: "var(--warning)" }}>
                          Syncing inbox metadata…
                          {syncRun && syncRun.messagesScanned > 0 && (
                            <> ({syncRun.messagesScanned} scanned, {syncRun.messagesProcessed} ingested)</>
                          )}
                        </span>
                      ) : syncRun ? (
                        syncRun.status === "success" ? (
                          <span style={{ color: "var(--success)" }}>
                            Last sync: {syncRun.messagesProcessed} interactions from {syncRun.messagesScanned} messages
                            {syncRun.finishedAt && <> · {new Date(syncRun.finishedAt).toLocaleString()}</>}
                          </span>
                        ) : syncRun.status === "failed" ? (
                          <span style={{ color: "var(--danger)" }}>
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
                    disabled={isSyncing}
                    style={{ minWidth: 100 }}
                  >
                    {isSyncing ? (
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span className="sync-spinner" />
                        Syncing…
                      </span>
                    ) : "Sync Now"}
                  </button>
                </div>

                {isSyncing && (
                  <div className="sync-progress">
                    <div className="sync-progress-bar" />
                  </div>
                )}
              </div>

              {/* Live feed of inbound metadata */}
              {(isSyncing || feedItems.length > 0) && (
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
                  <div className="text-sm font-medium mb-2">
                    Live Feed {isSyncing && <span className="text-xs text-muted">(streaming)</span>}
                  </div>
                  <div className="sync-feed">
                    {feedItems.length === 0 ? (
                      <div className="text-xs text-muted">Waiting for first message…</div>
                    ) : (
                      feedItems.map((it) => (
                        <div key={it.id} className="sync-feed-item">
                          <span
                            className={`feed-dir feed-dir-${it.direction}`}
                            title={it.direction === "sent" ? "You sent" : "You received"}
                          >
                            {it.direction === "sent" ? "→" : "←"}
                          </span>
                          <span className="feed-counterparty">
                            {it.counterpartyName || it.counterpartyEmail}
                          </span>
                          <span className="feed-time text-xs text-muted">
                            {new Date(it.occurredAt).toLocaleDateString()}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
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
    </div>
  );
}
