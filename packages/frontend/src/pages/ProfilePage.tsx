import { useState, useEffect } from "react";
import { useAuth } from "../hooks/useAuth.js";
import * as api from "../api/client.js";
import type { GoogleAccountStatus, GmailSyncRun } from "@connex/shared";

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

  useEffect(() => {
    loadGoogleStatus();
  }, []);

  const loadGoogleStatus = async () => {
    try {
      const [gs, ss] = await Promise.all([
        api.getGoogleStatus(),
        api.getGmailSyncStatus(),
      ]);
      setGoogleStatus(gs);
      setSyncStatus(ss);
    } catch {
      // Google not configured or not connected — that's fine
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
    try {
      const result = await api.triggerGmailSync();
      setSyncStatus(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSyncing(false);
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
                >
                  Disconnect
                </button>
              </div>

              <div style={{ borderTop: "1px solid #30363d", paddingTop: 12 }}>
                <div className="flex justify-between items-center">
                  <div>
                    <div className="text-sm font-medium">Gmail Sync</div>
                    <div className="text-xs text-muted mt-1">
                      {syncStatus && "status" in syncStatus
                        ? syncStatus.status === "never_synced"
                          ? "Never synced"
                          : syncStatus.status === "success"
                            ? `Last sync: ${(syncStatus as GmailSyncRun).messagesProcessed} messages processed`
                            : syncStatus.status === "running"
                              ? "Sync in progress..."
                              : `Last sync failed: ${(syncStatus as GmailSyncRun).errorMessage || "Unknown error"}`
                        : "Loading..."}
                    </div>
                  </div>
                  <button
                    className="btn btn-primary text-sm"
                    onClick={handleSync}
                    disabled={syncing}
                  >
                    {syncing ? "Syncing..." : "Sync Now"}
                  </button>
                </div>
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
    </div>
  );
}
