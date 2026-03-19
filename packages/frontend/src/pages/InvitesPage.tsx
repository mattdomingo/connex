import { useState, useEffect, useCallback } from "react";
import type { ApiInvite } from "@connex/shared";
import * as api from "../api/client.js";

export function InvitesPage() {
  const [invites, setInvites] = useState<ApiInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api.getMyInvites();
      setInvites(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="text-secondary">Loading...</div>;

  return (
    <div>
      <div className="page-header flex justify-between items-center">
        <div>
          <h1 className="page-title">Invites</h1>
          <p className="page-subtitle">Generate invite codes to bring people into Connex</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "Cancel" : "Create Invite"}
        </button>
      </div>

      {error && <div className="error-msg mb-4">{error}</div>}

      {showCreate && <CreateInviteForm onDone={() => { setShowCreate(false); load(); }} />}

      {invites.length === 0 ? (
        <div className="card text-secondary text-sm">No invites created yet.</div>
      ) : (
        invites.map((invite) => (
          <div key={invite.id} className="card">
            <div className="flex justify-between items-center">
              <div>
                <code style={{ fontSize: 16, fontWeight: 600, color: "var(--accent)" }}>
                  {invite.code}
                </code>
                {invite.recipientName && (
                  <span className="text-sm text-secondary" style={{ marginLeft: 8 }}>
                    for {invite.recipientName}
                  </span>
                )}
              </div>
              <div className="flex gap-2 items-center">
                <span className="text-xs text-muted">
                  {invite.useCount}/{invite.maxUses} used
                </span>
                {invite.useCount >= invite.maxUses ? (
                  <span className="badge badge-rejected">Exhausted</span>
                ) : invite.expiresAt && new Date(invite.expiresAt) < new Date() ? (
                  <span className="badge badge-rejected">Expired</span>
                ) : (
                  <span className="badge badge-accepted">Active</span>
                )}
              </div>
            </div>
            <div className="text-xs text-muted mt-2">
              Created {new Date(invite.createdAt).toLocaleDateString()}
              {invite.expiresAt && ` · Expires ${new Date(invite.expiresAt).toLocaleDateString()}`}
              {invite.recipientEmail && ` · ${invite.recipientEmail}`}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function CreateInviteForm({ onDone }: { onDone: () => void }) {
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [maxUses, setMaxUses] = useState(1);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.createInvite({
        recipientName: recipientName || undefined,
        recipientEmail: recipientEmail || undefined,
        maxUses,
      });
      onDone();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="card mb-4">
      <div className="card-header">Create Invite Code</div>
      {error && <div className="error-msg">{error}</div>}
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Recipient Name (optional)</label>
          <input className="form-input" value={recipientName} onChange={(e) => setRecipientName(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Recipient Email (optional)</label>
          <input className="form-input" type="email" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)} />
        </div>
        <div className="form-group">
          <label className="form-label">Max Uses</label>
          <input className="form-input" type="number" min={1} max={100} value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} />
        </div>
        <button type="submit" className="btn btn-primary">Generate Code</button>
      </form>
    </div>
  );
}
