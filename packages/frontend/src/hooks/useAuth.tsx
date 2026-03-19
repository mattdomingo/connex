import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import type { ApiPerson, ApiUser } from "@connex/shared";
import * as api from "../api/client.js";

interface AuthState {
  user: ApiUser | null;
  person: ApiPerson | null;
  token: string | null;
  loading: boolean;
}

interface AuthContextType extends AuthState {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name: string, inviteCode: string) => Promise<void>;
  signOut: () => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    person: null,
    token: localStorage.getItem("connex_token"),
    loading: true,
  });

  const loadUser = useCallback(async () => {
    const token = localStorage.getItem("connex_token");
    if (!token) {
      setState({ user: null, person: null, token: null, loading: false });
      return;
    }
    try {
      const { user, person } = await api.getMe();
      setState({ user, person, token, loading: false });
    } catch {
      localStorage.removeItem("connex_token");
      setState({ user: null, person: null, token: null, loading: false });
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const signIn = async (email: string, password: string) => {
    const result = await api.signIn({ email, password });
    localStorage.setItem("connex_token", result.token);
    setState({ user: result.user, person: result.person, token: result.token, loading: false });
  };

  const signUp = async (email: string, password: string, name: string, inviteCode: string) => {
    const result = await api.signUp({ email, password, name, inviteCode });
    localStorage.setItem("connex_token", result.token);
    setState({ user: result.user, person: result.person, token: result.token, loading: false });
  };

  const signOut = () => {
    localStorage.removeItem("connex_token");
    setState({ user: null, person: null, token: null, loading: false });
  };

  const refreshProfile = async () => {
    const person = await api.getMyProfile();
    setState((prev) => ({ ...prev, person }));
  };

  return (
    <AuthContext.Provider value={{ ...state, signIn, signUp, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
