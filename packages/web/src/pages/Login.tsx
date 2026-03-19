import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../api/auth-context";

export default function LoginPage() {
  const { refresh } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await api.login({ email, password });
      await refresh();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-container">
      <h1>Connex</h1>
      <div className="panel">
        <h2>Sign in</h2>
        <form onSubmit={submit}>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div className="field">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          {err && <div className="error">{err}</div>}
          <button type="submit" disabled={busy} style={{ width: "100%", marginTop: 8 }}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p className="hint" style={{ marginTop: 16 }}>
          Have an invite? <Link to="/register">Register</Link>
        </p>
        <details style={{ marginTop: 12 }}>
          <summary className="hint" style={{ cursor: "pointer" }}>Demo accounts</summary>
          <div className="hint" style={{ marginTop: 8, lineHeight: 1.6 }}>
            <code>alice@example.com</code> (premium)<br />
            <code>bob@example.com</code> (free)<br />
            <code>carol@example.com</code> (free)<br />
            Password: <code>password123</code>
          </div>
        </details>
      </div>
    </div>
  );
}
