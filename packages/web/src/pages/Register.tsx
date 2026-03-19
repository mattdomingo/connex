import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../api/auth-context";

export default function RegisterPage() {
  const { refresh } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [inviteCode, setInviteCode] = useState(params.get("invite") ?? "");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteStatus, setInviteStatus] = useState<
    { valid: boolean; intendedName?: string; intendedEmail?: string; error?: string } | null
  >(null);

  useEffect(() => {
    if (inviteCode.length < 4) {
      setInviteStatus(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api.checkInvite(inviteCode);
        setInviteStatus(res);
        if (res.intendedName && !name) setName(res.intendedName);
        if (res.intendedEmail && !email) setEmail(res.intendedEmail);
      } catch {
        setInviteStatus(null);
      }
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteCode]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.register({ inviteCode, name, email, password });
      await refresh();
      // Kick off Gmail onboarding if not already linked.
      try {
        const gs = await api.getGmailStatus();
        nav(gs.connected ? "/graph" : "/profile?gmail=connect", {
          replace: true,
        });
      } catch {
        nav("/profile?gmail=connect", { replace: true });
      }
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="auth-container">
      <h1>Connex</h1>
      <div className="panel">
        <h2>Create account</h2>
        <p className="hint">Registration requires a valid invite code.</p>
        <form onSubmit={submit}>
          <div className="field">
            <label>Invite code</label>
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="CONNEX-BOOTSTRAP"
              required
            />
            {inviteStatus && (
              <div
                className={inviteStatus.valid ? "hint" : "error"}
                style={{ marginTop: 4 }}
              >
                {inviteStatus.valid
                  ? `Valid invite${inviteStatus.intendedName ? ` · intended for ${inviteStatus.intendedName}` : ""}`
                  : inviteStatus.error}
              </div>
            )}
          </div>
          <div className="field">
            <label>Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          {err && <div className="error">{err}</div>}
          <button
            type="submit"
            disabled={busy || inviteStatus?.valid === false}
            style={{ width: "100%", marginTop: 8 }}
          >
            {busy ? "Creating…" : "Create account"}
          </button>
        </form>
        <p className="hint" style={{ marginTop: 16 }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
