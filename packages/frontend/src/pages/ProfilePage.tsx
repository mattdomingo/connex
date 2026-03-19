import { useState } from "react";
import { useAuth } from "../hooks/useAuth.js";
import * as api from "../api/client.js";

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
    </div>
  );
}
