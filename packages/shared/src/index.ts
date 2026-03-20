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
export const FREE_TIER_MAX_DEGREE = 3;

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
  tieStrength?: number;
}

export interface GraphEdge {
  id: number;
  source: number;
  target: number;
  relationshipType: RelationshipType;
  closenessScore: number;
  status: ConnectionStatus;
  tieStrength?: number;
  edgeSource?: "manual" | "gmail";
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

// ── Gmail / Integration Types ──

export interface GoogleAccountStatus {
  connected: boolean;
  email: string | null;
  scopes: string | null;
  connectedAt: string | null;
}

export interface GmailSyncRun {
  id: number;
  userId: number;
  status: "running" | "success" | "failed";
  startedAt: string;
  finishedAt: string | null;
  messagesScanned: number;
  messagesProcessed: number;
  errorMessage: string | null;
}

export interface GmailSyncFeedItem {
  seq: number;
  counterpartyEmail: string;
  counterpartyName: string | null;
  direction: "sent" | "received";
  occurredAt: string;
  timestamp: string;
}

export interface RankedConnection {
  personId: number;
  name: string;
  email: string | null;
  domain: string | null;
  company: string | null;
  tieStrength: number;
  interactionCount: number;
  sentCount: number;
  receivedCount: number;
  lastInteractionAt: string | null;
  hidden?: boolean;
}

export interface InteractionEvidence {
  personId: number;
  name: string;
  email: string | null;
  totalInteractions: number;
  sentCount: number;
  receivedCount: number;
  directCount: number;
  ccCount: number;
  lastInteractionAt: string | null;
  firstInteractionAt: string | null;
  recencyBuckets: {
    last7days: number;
    last30days: number;
    last90days: number;
    older: number;
  };
  topThreads: number;
}

// ── Intro Request Types ──

export const INTRO_REQUEST_STATUSES = [
  "pending",
  "accepted",
  "declined",
  "cancelled",
] as const;
export type IntroRequestStatus = (typeof INTRO_REQUEST_STATUSES)[number];

export interface ApiIntroRequest {
  id: number;
  requesterUserId: number;
  requesterPersonId: number;
  targetPersonId: number;
  intermediaryPersonId: number;
  status: IntroRequestStatus;
  requestNote: string | null;
  responseNote: string | null;
  createdAt: string;
  respondedAt: string | null;
  requesterPerson?: ApiPerson;
  targetPerson?: ApiPerson;
  intermediaryPerson?: ApiPerson;
}

export interface CreateIntroRequestPayload {
  targetPersonId: number;
  intermediaryPersonId: number;
  requestNote?: string;
}

export interface RespondIntroRequestPayload {
  action: "accept" | "decline";
  responseNote?: string;
}

// ── API Error ──

export interface ApiError {
  error: string;
  details?: string;
}
