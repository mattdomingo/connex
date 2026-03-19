import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";

export function GoogleCallbackPage() {
  const [searchParams] = useSearchParams();
  const { setTokenFromCallback } = useAuth();
  const navigate = useNavigate();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const token = searchParams.get("token");
    if (token) {
      setTokenFromCallback(token).then(() => {
        navigate("/graph", { replace: true });
      });
    } else {
      navigate("/signin?error=Google+sign-in+failed", { replace: true });
    }
  }, [searchParams, setTokenFromCallback, navigate]);

  return (
    <div className="auth-container">
      <div className="text-secondary">Completing sign in...</div>
    </div>
  );
}
