import type {
  AuthResponse,
  SignInRequest,
  SignUpRequest,
  ApiPerson,
  ApiConnection,
  ApiConnectionWithPeople,
  ApiInvite,
  CreatePersonRequest,
  CreateConnectionRequest,
  CreateInviteRequest,
  UpdateProfileRequest,
  RespondConnectionRequest,
  GraphData,
  ShortestPathResult,
  SearchResult,
} from "@connex/shared";

const BASE = "/api";

function getToken(): string | null {
  return localStorage.getItem("connex_token");
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || `Request failed: ${res.status}`);
  }

  return data as T;
}

// Auth
export const signUp = (data: SignUpRequest) =>
  request<AuthResponse>("/auth/signup", { method: "POST", body: JSON.stringify(data) });

export const signIn = (data: SignInRequest) =>
  request<AuthResponse>("/auth/signin", { method: "POST", body: JSON.stringify(data) });

export const getMe = () =>
  request<{ user: any; person: ApiPerson }>("/auth/me");

// Profile
export const getMyProfile = () => request<ApiPerson>("/persons/me");

export const updateMyProfile = (data: UpdateProfileRequest) =>
  request<ApiPerson>("/persons/me", { method: "PUT", body: JSON.stringify(data) });

export const getPerson = (id: number) => request<ApiPerson>(`/persons/${id}`);

export const createPerson = (data: CreatePersonRequest) =>
  request<ApiPerson>("/persons", { method: "POST", body: JSON.stringify(data) });

export const searchPersons = (q: string) =>
  request<ApiPerson[]>(`/persons?q=${encodeURIComponent(q)}`);

// Connections
export const createConnection = (data: CreateConnectionRequest) =>
  request<ApiConnection>("/connections", { method: "POST", body: JSON.stringify(data) });

export const getMyConnections = (status?: string) =>
  request<ApiConnectionWithPeople[]>(`/connections/mine${status ? `?status=${status}` : ""}`);

export const getPendingConnections = () =>
  request<ApiConnectionWithPeople[]>("/connections/pending");

export const respondToConnection = (id: number, data: RespondConnectionRequest) =>
  request<ApiConnection>(`/connections/${id}/respond`, { method: "PUT", body: JSON.stringify(data) });

// Invites
export const createInvite = (data: CreateInviteRequest) =>
  request<ApiInvite>("/invites", { method: "POST", body: JSON.stringify(data) });

export const getMyInvites = () => request<ApiInvite[]>("/invites/mine");

export const validateInvite = (code: string) =>
  request<{ valid: boolean; recipientName?: string; recipientEmail?: string }>(`/invites/validate/${code}`);

// Graph
export const getGraph = (center?: number) =>
  request<GraphData>(`/graph/explore${center ? `?center=${center}` : ""}`);

export const getShortestPath = (fromId: number, toId: number) =>
  request<ShortestPathResult>(`/graph/path/${fromId}/${toId}`);

export const searchGraph = (q: string) =>
  request<SearchResult[]>(`/graph/search?q=${encodeURIComponent(q)}`);
