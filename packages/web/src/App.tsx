import { Routes, Route, Navigate, NavLink, useNavigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./api/auth-context";
import LoginPage from "./pages/Login";
import RegisterPage from "./pages/Register";
import GraphPage from "./pages/Graph";
import ProfilePage from "./pages/Profile";
import InvitesPage from "./pages/Invites";
import PeoplePage from "./pages/People";
import ConnectionsPage from "./pages/Connections";
import IntroductionsPage from "./pages/Introductions";

function Shell() {
  const { user, loading, logout } = useAuth();
  const nav = useNavigate();

  if (loading) {
    return <div style={{ padding: 40 }}>Loading…</div>;
  }
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="brand">Connex</div>
        <NavLink to="/graph" className={({ isActive }) => (isActive ? "active" : "")}>
          Graph
        </NavLink>
        <NavLink to="/connections" className={({ isActive }) => (isActive ? "active" : "")}>
          Connections
        </NavLink>
        <NavLink to="/introductions" className={({ isActive }) => (isActive ? "active" : "")}>
          Introductions
        </NavLink>
        <NavLink to="/people" className={({ isActive }) => (isActive ? "active" : "")}>
          People
        </NavLink>
        <NavLink to="/invites" className={({ isActive }) => (isActive ? "active" : "")}>
          Invites
        </NavLink>
        <NavLink to="/profile" className={({ isActive }) => (isActive ? "active" : "")}>
          Profile
        </NavLink>
        <div className="spacer" />
        <span className={`tier-badge ${user.tier}`}>{user.tier}</span>
        <div className="hint" style={{ marginBottom: 8 }}>{user.person.name}</div>
        <button
          className="secondary"
          onClick={async () => {
            await logout();
            nav("/login");
          }}
        >
          Sign out
        </button>
      </nav>
      <main className="content">
        <Routes>
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/introductions" element={<IntroductionsPage />} />
          <Route path="/people" element={<PeoplePage />} />
          <Route path="/invites" element={<InvitesPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="*" element={<Navigate to="/graph" replace />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
