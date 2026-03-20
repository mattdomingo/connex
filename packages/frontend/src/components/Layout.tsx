import React from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import { useTheme, type ThemeMode } from "../hooks/useTheme.js";
import { useSyncStatus } from "../hooks/useSyncStatus.js";

export function Layout({ children }: { children: React.ReactNode }) {
  const { user, person, signOut } = useAuth();
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

  const modes: { value: ThemeMode; label: string }[] = [
    { value: "light", label: "Light" },
    { value: "system", label: "System" },
    { value: "dark", label: "Dark" },
  ];

  const isPremium = user?.isPremium ?? false;

  return (
    <div className="app-layout">
      <nav className="sidebar">
        <div className="sidebar-brand">
          Connex
          <span
            className={`plan-badge ${isPremium ? "plan-badge--premium" : "plan-badge--free"}`}
            title={isPremium ? "Premium account" : "Free account"}
          >
            {isPremium ? "Premium" : "Free"}
          </span>
        </div>
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
          <div className="theme-segment" role="radiogroup" aria-label="Theme">
            {modes.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={mode === m.value}
                className={`theme-segment-btn${mode === m.value ? " active" : ""}`}
                onClick={() => setMode(m.value)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className="font-medium mt-2">{person?.name}</div>
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
