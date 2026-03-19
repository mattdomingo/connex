import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "./hooks/useAuth.js";
import { Layout } from "./components/Layout.js";
import { SignInPage } from "./pages/SignInPage.js";
import { SignUpPage } from "./pages/SignUpPage.js";
import { GraphPage } from "./pages/GraphPage.js";
import { ConnectionsPage } from "./pages/ConnectionsPage.js";
import { ProfilePage } from "./pages/ProfilePage.js";
import { InvitesPage } from "./pages/InvitesPage.js";
import { SearchPage } from "./pages/SearchPage.js";

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="auth-container">
        <div className="text-secondary">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/signin" element={<SignInPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="*" element={<Navigate to="/signin" replace />} />
      </Routes>
    );
  }

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to="/graph" replace />} />
        <Route path="/graph" element={<GraphPage />} />
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/invites" element={<InvitesPage />} />
        <Route path="*" element={<Navigate to="/graph" replace />} />
      </Routes>
    </Layout>
  );
}
