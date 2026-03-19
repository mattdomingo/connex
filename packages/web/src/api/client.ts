import type {
  Connection,
  CreateConnectionRequest,
  CreateInviteRequest,
  CreatePersonRequest,
  GraphNeighborhood,
  Invite,
  LoginRequest,
  PathResult,
  Person,
  RegisterRequest,
  SearchResultItem,
  UpdateProfileRequest,
  UserProfile,
  RelationshipType,
} from "@connex/shared";

class ApiClient {
  private base = "/api";

  private async req<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await fetch(this.base + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      credentials: "include",
    });
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText}`;
      try {
        const data = await res.json();
        if (data?.error) msg = data.error;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    return res.json();
  }

  // --- Auth ---
  login(body: LoginRequest) {
    return this.req<{ ok: true }>("POST", "/auth/login", body);
  }
  register(body: RegisterRequest) {
    return this.req<{ ok: true }>("POST", "/auth/register", body);
  }
  logout() {
    return this.req<{ ok: true }>("POST", "/auth/logout");
  }
  me() {
    return this.req<UserProfile>("GET", "/auth/me");
  }
  checkInvite(code: string) {
    return this.req<{ valid: boolean; intendedName?: string; intendedEmail?: string; error?: string }>(
      "GET",
      `/auth/invite/${encodeURIComponent(code)}`,
    );
  }

  // --- Profile ---
  updateProfile(body: UpdateProfileRequest) {
    return this.req<Person>("PATCH", "/profile", body);
  }

  // --- Invites ---
  listInvites() {
    return this.req<Invite[]>("GET", "/invites");
  }
  createInvite(body: CreateInviteRequest) {
    return this.req<Invite>("POST", "/invites", body);
  }
  revokeInvite(id: number) {
    return this.req<{ ok: true }>("POST", `/invites/${id}/revoke`);
  }

  // --- People ---
  createPerson(body: CreatePersonRequest) {
    return this.req<Person>("POST", "/people", body);
  }
  getPerson(id: number) {
    return this.req<Person>("GET", `/people/${id}`);
  }
  listPeople(q: string) {
    const qs = q ? `?q=${encodeURIComponent(q)}` : "";
    return this.req<Person[]>("GET", `/people${qs}`);
  }

  // --- Connections ---
  listConnections() {
    return this.req<Connection[]>("GET", "/connections");
  }
  listPending() {
    return this.req<Connection[]>("GET", "/connections/pending");
  }
  createConnection(body: CreateConnectionRequest) {
    return this.req<Connection>("POST", "/connections", body);
  }
  respondConnection(id: number, action: "accept" | "reject") {
    return this.req<Connection>("POST", `/connections/${id}/respond`, {
      action,
    });
  }

  // --- Graph ---
  explore(degree: number, center?: number) {
    const params = new URLSearchParams({ degree: String(degree) });
    if (center) params.set("center", String(center));
    return this.req<GraphNeighborhood>("GET", `/graph/explore?${params}`);
  }
  path(to: number) {
    return this.req<PathResult>("GET", `/graph/path?to=${to}`);
  }
  search(q: string, relationshipType?: RelationshipType, maxDegree?: number) {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (relationshipType) params.set("relationshipType", relationshipType);
    if (maxDegree) params.set("maxDegree", String(maxDegree));
    return this.req<SearchResultItem[]>("GET", `/graph/search?${params}`);
  }
}

export const api = new ApiClient();
