import React from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import { useTheme, type ThemeMode } from "../hooks/useTheme.js";
import { useSyncStatus } from "../hooks/useSyncStatus.js";

export function Layout({ children }: { children: React.ReactNode }) {
  const { person, signOut } = useAuth();
  const { mode, setMode } = useTheme();
  const { run, isSyncing } = useSyncStatus();

  const links = [
    { to: "/graph", label: "Graph Explorer" },
    { to: "/connections", label: "Connections" },
    { to: "/introductions", label: "Introductions" },
    { to: "/search", label: "Search" },
    { to: "/invites", label: "Invites" },
    { to: "/profile", label: "Profile" },
  ];

  const cycleTheme = () => {
    const order: ThemeMode[] = ["system", "light", "dark"];
    setMode(order[(order.indexOf(mode) + 1) % order.length]);
  };

  const themeIcon =
    mode === "light" ? "☀️" : mode === "dark" ? "🌙" : "🖥️";

  return (
    <div className="app-layout">
      <nav className="sidebar">
        <div className="sidebar-brand">Connex</div>
        <div className="sidebar-nav">
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `sidebar-link${isActive ? " active" : ""}`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </div>
        <div className="sidebar-footer">
          <button
            type="button"
            className="btn btn-sm w-full mb-2"
            onClick={cycleTheme}
            title={`Theme: ${mode} (click to cycle)`}
          >
            {themeIcon} {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
          <div className="font-medium">{person?.name}</div>
          <div className="text-xs mt-2" style={{ cursor: "pointer" }} onClick={signOut}>
            Sign out
          </div>
        </div>
      </nav>
      <main className="main-content">
        {isSyncing && (
          <div className="sync-banner">
            <span className="sync-spinner" />
            <span>
              Syncing inbox metadata…
              {run && run.messagesScanned > 0 && (
                <span className="text-xs text-muted" style={{ marginLeft: 6 }}>
                  {run.messagesProcessed} interactions · {run.messagesScanned} scanned
                </span>
              )}
            </span>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
