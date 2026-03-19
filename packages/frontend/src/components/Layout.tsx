import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";

export function Layout({ children }: { children: React.ReactNode }) {
  const { person, signOut } = useAuth();
  const location = useLocation();

  const links = [
    { to: "/graph", label: "Graph Explorer" },
    { to: "/connections", label: "Connections" },
    { to: "/top-connections", label: "Top Connections" },
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
          <div className="text-xs mt-2" style={{ cursor: "pointer" }} onClick={signOut}>
            Sign out
          </div>
        </div>
      </nav>
      <main className="main-content">{children}</main>
    </div>
  );
}
