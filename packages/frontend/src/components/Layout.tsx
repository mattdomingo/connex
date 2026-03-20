import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";
import { useSyncStatus } from "../hooks/useSyncStatus.js";
import { useTheme } from "../hooks/useTheme.js";

export function Layout({ children }: { children: React.ReactNode }) {
  const { person, signOut } = useAuth();
  const location = useLocation();
  const { syncing, messagesScanned } = useSyncStatus();
  const { mode, setMode } = useTheme();

  const cycleTheme = () => {
    const order: Array<"dark" | "light" | "system"> = ["dark", "light", "system"];
    const next = order[(order.indexOf(mode) + 1) % order.length];
    setMode(next);
  };

  const themeLabel = mode === "dark" ? "Dark" : mode === "light" ? "Light" : "System";

  const links = [
    { to: "/graph", label: "Graph Explorer" },
    { to: "/connections", label: "Connections" },
    { to: "/introductions", label: "Introductions" },
    { to: "/search", label: "Search" },
    { to: "/invites", label: "Invites" },
    { to: "/profile", label: "Profile" },
  ];

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
          <div className="font-medium">{person?.name}</div>
          <div className="flex justify-between items-center mt-2">
            <div className="text-xs" style={{ cursor: "pointer" }} onClick={signOut}>
              Sign out
            </div>
            <div
              className="text-xs"
              style={{ cursor: "pointer", color: "var(--accent)" }}
              onClick={cycleTheme}
              title={`Theme: ${themeLabel}`}
            >
              {themeLabel}
            </div>
          </div>
        </div>
      </nav>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {syncing && (
          <div className="sync-banner">
            <span className="sync-banner-dot" />
            Syncing inbox{messagesScanned > 0 ? ` (${messagesScanned} scanned)` : ""}...
          </div>
        )}
        <main className="main-content" style={{ flex: 1 }}>{children}</main>
      </div>
    </div>
  );
}
