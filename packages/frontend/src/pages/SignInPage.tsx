import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";

export function SignInPage() {
  const { signIn } = useAuth();
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("alice@demo.com");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState(searchParams.get("error") || "");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = () => {
    window.location.href = "/api/auth/google/start";
  };

  return (
    <div className="auth-container">
      <div className="auth-card card">
        <h1 className="auth-title">Connex</h1>
        <p className="auth-subtitle">Sign in to explore your relationship graph</p>

        {error && <div className="error-msg">{error}</div>}

        <button
          type="button"
          className="btn w-full"
          onClick={handleGoogleSignIn}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            marginBottom: 16,
            background: "#fff",
            color: "#333",
            border: "1px solid #dadce0",
          }}
        >
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.1 24.1 0 0 0 0 21.56l7.98-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          Continue with Google
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1, height: 1, background: "#30363d" }} />
          <span className="text-xs text-muted">or</span>
          <div style={{ flex: 1, height: 1, background: "#30363d" }} />
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary w-full" disabled={loading}>
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p className="text-sm text-secondary mt-4">
          Have an invite code? <Link to="/signup">Sign up</Link>
        </p>
        <p className="text-xs text-muted mt-2">
          Demo: alice@demo.com / password123
        </p>
      </div>
    </div>
  );
}
