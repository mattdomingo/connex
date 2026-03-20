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
  GoogleAccountStatus,
  GmailSyncRun,
  GmailSyncFeedItem,
  RankedConnection,
  InteractionEvidence,
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

export interface ReachablePerson {
  id: number;
  name: string;
  email: string | null;
  company: string | null;
  degree: number | null;
  locked: boolean;
  isUser: boolean;
}

export interface IntermediaryOption {
  id: number;
  name: string;
  email: string | null;
  company: string | null;
  isUser: boolean;
  degreeFromRequester: number;
  degreeToTarget: number;
  totalHops: number;
}

export interface IntermediariesResponse {
  reachable: boolean;
  totalDegrees: number;
  intermediaries: IntermediaryOption[];
}

export const getReachablePeople = () =>
  request<ReachablePerson[]>("/graph/reachable");

export const getIntermediaries = (targetId: number) =>
  request<IntermediariesResponse>(`/graph/intermediaries/${targetId}`);

export interface NextHopOption {
  id: number;
  name: string;
  email: string | null;
  company: string | null;
  isUser: boolean;
  hopsToTarget: number;
  isTarget: boolean;
}

export interface NextHopsResponse {
  hops: NextHopOption[];
}

export const getNextHops = (fromId: number, targetId: number) =>
  request<NextHopsResponse>(`/graph/next-hops/${fromId}/${targetId}`);

// Google / Gmail
export const getGoogleStatus = () =>
  request<GoogleAccountStatus>("/integrations/google/status");

export const disconnectGoogle = () =>
  request<{ success: boolean }>("/integrations/google/disconnect", { method: "POST" });

export const triggerGmailSync = () =>
  request<GmailSyncRun>("/gmail/sync", { method: "POST" });

export const getGmailSyncStatus = () =>
  request<GmailSyncRun | { status: "never_synced" }>("/gmail/sync/status");

export const getGmailSyncFeed = (after?: number) =>
  request<GmailSyncFeedItem[]>(`/gmail/sync/feed${after != null ? `?after=${after}` : ""}`);

export const getTopConnections = (opts?: {
  limit?: number;
  company?: string;
  q?: string;
  showHidden?: boolean;
}) => {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.company) params.set("company", opts.company);
  if (opts?.q) params.set("q", opts.q);
  if (opts?.showHidden) params.set("showHidden", "true");
  const qs = params.toString();
  return request<RankedConnection[]>(`/me/top-connections${qs ? `?${qs}` : ""}`);
};

export const getConnectionEvidence = (personId: number) =>
  request<InteractionEvidence>(`/me/connections/${personId}/evidence`);

export const hideContact = (personId: number) =>
  request<{ success: boolean }>(`/me/connections/${personId}/hide`, { method: "POST" });

export const unhideContact = (personId: number) =>
  request<{ success: boolean }>(`/me/connections/${personId}/hide`, { method: "DELETE" });

// Intro Requests
import type {
  ApiIntroRequest,
  CreateIntroRequestPayload,
  RespondIntroRequestPayload,
} from "@connex/shared";

export const createIntroRequest = (data: CreateIntroRequestPayload) =>
  request<ApiIntroRequest>("/intro-requests", { method: "POST", body: JSON.stringify(data) });

export const getSentIntroRequests = () =>
  request<ApiIntroRequest[]>("/intro-requests/sent");

export const getInboxIntroRequests = () =>
  request<ApiIntroRequest[]>("/intro-requests/inbox");

export const respondToIntroRequest = (id: number, data: RespondIntroRequestPayload) =>
  request<ApiIntroRequest>(`/intro-requests/${id}/respond`, { method: "POST", body: JSON.stringify(data) });

export const cancelIntroRequest = (id: number) =>
  request<ApiIntroRequest>(`/intro-requests/${id}/cancel`, { method: "POST" });
