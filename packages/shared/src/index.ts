// ── Enums & Constants ──

export const RELATIONSHIP_TYPES = [
  "friend",
  "coworker",
  "classmate",
  "family",
  "other",
] as const;
export type RelationshipType = (typeof RELATIONSHIP_TYPES)[number];

export const CONNECTION_STATUSES = [
  "pending",
  "accepted",
  "rejected",
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const MAX_CLOSENESS = 10;
export const MIN_CLOSENESS = 1;
export const FREE_TIER_MAX_DEGREE = 2;

// ── API Types ──

export interface ApiUser {
  id: number;
  email: string;
  personId: number;
  createdAt: string;
}

export interface ApiPerson {
  id: number;
  name: string;
  email: string | null;
  bio: string | null;
  company: string | null;
  school: string | null;
  location: string | null;
  userId: number | null;
  createdByUserId: number;
  createdAt: string;
}

export interface ApiConnection {
  id: number;
  sourcePersonId: number;
  targetPersonId: number;
  relationshipType: RelationshipType;
  closenessScore: number;
  note: string | null;
  status: ConnectionStatus;
  createdByUserId: number;
  createdAt: string;
  updatedAt: string;
}

export interface ApiConnectionWithPeople extends ApiConnection {
  sourcePerson: ApiPerson;
  targetPerson: ApiPerson;
}

export interface ApiInvite {
  id: number;
  code: string;
  createdByUserId: number;
  recipientName: string | null;
  recipientEmail: string | null;
  maxUses: number;
  useCount: number;
  expiresAt: string | null;
  createdAt: string;
}

// ── Request/Response Types ──

export interface SignUpRequest {
  email: string;
  password: string;
  name: string;
  inviteCode: string;
}

export interface SignInRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: ApiUser;
  person: ApiPerson;
}

export interface UpdateProfileRequest {
  name?: string;
  bio?: string | null;
  company?: string | null;
  school?: string | null;
  location?: string | null;
}

export interface CreatePersonRequest {
  name: string;
  email?: string;
  bio?: string;
  company?: string;
  school?: string;
  location?: string;
}

export interface CreateConnectionRequest {
  sourcePersonId: number;
  targetPersonId: number;
  relationshipType: RelationshipType;
  closenessScore: number;
  note?: string;
}

export interface CreateInviteRequest {
  recipientName?: string;
  recipientEmail?: string;
  maxUses?: number;
  expiresAt?: string;
}

export interface RespondConnectionRequest {
  status: "accepted" | "rejected";
}

// ── Graph Exploration Types ──

export interface GraphNode {
  id: number;
  name: string;
  company: string | null;
  location: string | null;
  isUser: boolean;
  degree: number;
  locked: boolean;
}

export interface GraphEdge {
  id: number;
  source: number;
  target: number;
  relationshipType: RelationshipType;
  closenessScore: number;
  status: ConnectionStatus;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  centerPersonId: number;
}

export interface ShortestPathResult {
  path: GraphNode[];
  edges: GraphEdge[];
  locked: boolean;
  totalDegrees: number;
}

export interface SearchResult {
  person: ApiPerson;
  degree: number | null;
  connectionContext: string | null;
  locked: boolean;
}

// ── API Error ──

export interface ApiError {
  error: string;
  details?: string;
}
