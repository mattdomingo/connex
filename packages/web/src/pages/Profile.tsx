import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
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
    </div>
  );
}
