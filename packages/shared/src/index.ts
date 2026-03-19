// ---------------------------------------------------------------------------
// Shared contracts used by both server and web clients.
// Keep this file framework-agnostic.
// ---------------------------------------------------------------------------

export type RelationshipType =
  | "friend"
  | "coworker"
  | "classmate"
  | "family"
  | "other";

export const RELATIONSHIP_TYPES: RelationshipType[] = [
  "friend",
  "coworker",
  "classmate",
  "family",
  "other",
];

export type ConnectionStatus = "pending" | "active" | "rejected";
export type UserTier = "free" | "premium";

export interface Person {
  id: number;
  name: string;
  email: string | null;
  bio: string | null;
  company: string | null;
  school: string | null;
  location: string | null;
  isRegistered: boolean;
  createdAt: string;
}

export interface UserProfile {
  userId: number;
  personId: number;
  email: string;
  tier: UserTier;
  person: Person;
}

export interface Connection {
  id: number;
  aPersonId: number;
  bPersonId: number;
  relationshipType: RelationshipType;
  trustScore: number; // 1-10
  note: string | null;
  status: ConnectionStatus;
  createdByUserId: number;
  confirmRequiredFromPersonId: number | null;
  createdAt: string;
  // hydrated endpoints when returned from /connections list
  a?: Person;
  b?: Person;
}

export interface Invite {
  id: number;
  code: string;
  createdByUserId: number;
  intendedName: string | null;
  intendedEmail: string | null;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  createdAt: string;
  revoked: boolean;
}

// --- Graph exploration payloads ----------------------------------------------

export interface GraphNode {
  personId: number;
  name: string;
  degree: number; // distance from the requesting user's person node
  isRegistered: boolean;
  locked: boolean; // true when degree exceeds entitlement and details are hidden
  company?: string | null;
  school?: string | null;
  location?: string | null;
}

export interface GraphEdge {
  id: number;
  source: number; // personId
  target: number; // personId
  relationshipType: RelationshipType;
  trustScore: number;
  status: ConnectionStatus;
  locked: boolean;
}

export interface GraphNeighborhood {
  center: number; // personId
  maxDegree: number; // what was requested
  entitlementDegree: number; // what the user is allowed to see fully
  nodes: GraphNode[];
  edges: GraphEdge[];
  lockedCount: number; // number of nodes beyond entitlement
}

export interface PathResult {
  found: boolean;
  fromPersonId: number;
  toPersonId: number;
  length: number; // edge count, -1 if not found
  locked: boolean; // true if path length exceeds entitlement
  nodes: GraphNode[]; // intermediate nodes may be redacted when locked
  edges: GraphEdge[];
}

// --- Request bodies ---------------------------------------------------------

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  inviteCode: string;
  email: string;
  password: string;
  name: string;
}

export interface CreateInviteRequest {
  intendedName?: string;
  intendedEmail?: string;
  maxUses?: number;
  expiresInHours?: number;
}

export interface CreatePersonRequest {
  name: string;
  email?: string;
  bio?: string;
  company?: string;
  school?: string;
  location?: string;
}

export interface UpdateProfileRequest {
  name?: string;
  bio?: string | null;
  company?: string | null;
  school?: string | null;
  location?: string | null;
}

export interface CreateConnectionRequest {
  sourcePersonId: number;
  targetPersonId: number;
  relationshipType: RelationshipType;
  trustScore: number;
  note?: string;
}

export interface SearchQuery {
  q?: string;
  relationshipType?: RelationshipType;
  maxDegree?: number;
}

export interface SearchResultItem {
  person: Person;
  degree: number | null; // null = unreachable within search radius
  via: string[]; // relationship-type breadcrumb from viewer to this person
  locked: boolean;
}

// --- API response envelope --------------------------------------------------

export interface ApiError {
  error: string;
  code?: string;
}
