export type ApiFieldError = {
  path: string;
  code: string;
  message: string;
};

export type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    requestId: string;
    details: { fields?: ApiFieldError[]; [key: string]: unknown } | null;
  };
};

export type PageInfo = {
  hasNextPage: boolean;
  endCursor: string | null;
};

export type Connection<T> = {
  nodes: T[];
  pageInfo: PageInfo;
};

export type ServerCapabilities = {
  agentExecution: boolean;
  metrics: boolean;
  realtime: boolean;
  storage: boolean;
  valkey: boolean;
  planner: boolean;
  modelGateway: boolean;
  voiceAgents: boolean;
  githubSignIn: boolean;
  passwordlessLogin: boolean;
  emailRegistration: boolean;
  magicLink: boolean;
  passwordReset: boolean;
  twoFactor: boolean;
};

export type ServerConfig = {
  version: string | null;
  signInOrigin: string | null;
  capabilities: ServerCapabilities;
};

export type ApiProfile = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApiWorkspace = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  settings: {
    issuePrefix: string;
    defaultRole: string;
    allowMemberInvites: boolean;
  };
  role: string;
  logoUrl?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BootstrapResponse = {
  user: ApiProfile;
  workspaces: ApiWorkspace[];
  currentWorkspaceId: string | null;
  serverTime: string;
};

export type ApiBoardColumn = {
  id: string;
  name: string;
};

export type ApiBoard = {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string | null;
  columns: ApiBoardColumn[];
  createdAt: string;
  updatedAt: string;
};

export type ApiMember = {
  userId: string;
  workspaceId: string;
  role: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  joinedAt: string;
  updatedAt: string;
};

export type ApiAgent = {
  id: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  status: string;
  roleKey?: string | null;
  department?: string | null;
  archivedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApiProject = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  status: string;
  priority: string;
  health: string;
  createdAt: string;
  updatedAt: string;
};

export type ApiActorRef = {
  type: 'user' | 'agent';
  id: string;
  name: string;
  avatarUrl: string | null;
};

export type ApiIssueStatus =
  | 'backlog'
  | 'todo'
  | 'inProgress'
  | 'inReview'
  | 'done'
  | 'blocked'
  | 'cancelled';

export type ApiIssuePriority = 'none' | 'low' | 'medium' | 'high' | 'urgent';

export type ApiIssue = {
  id: string;
  boardId: string;
  number: number;
  identifier: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  sortOrder: number;
  startDate: string | null;
  dueDate: string | null;
  assignee: ApiActorRef | null;
  activeRunId: string | null;
  project?: { id: string; name: string } | null;
  createdBy: ApiActorRef | null;
  createdAt: string;
  updatedAt: string;
  autoGate?: boolean;
};

export type ApiComment = {
  id: string;
  issueId: string;
  body: string;
  author: ApiActorRef;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApiActivityItem = {
  id: string;
  type: string;
  occurredAt: string;
  actor: {
    type: string;
    id: string;
    name: string | null;
    avatarUrl: string | null;
  } | null;
  changedFields: string[];
  previousStatus: string | null;
  status: string | null;
  commentId: string | null;
  details: Record<string, unknown>;
};

export type ApiInboxItem = {
  id: string;
  workspaceId: string;
  recipientId: string;
  eventType: string;
  category: string;
  severity: string;
  issueId: string | null;
  issueStatus: string | null;
  issueIdentifier: string | null;
  actorType: string | null;
  actorId: string | null;
  title: string;
  body: string;
  details: Record<string, unknown> | null;
  read: boolean;
  archived: boolean;
  createdAt: string;
  approvalId: string | null;
  milestoneId: string | null;
  planId: string | null;
};

export type ApiApproval = {
  id: string;
  workspaceId: string;
  kind: string;
  risk: string;
  title: string;
  description: string | null;
  issueId: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  decisionNote: string | null;
  requestedAt: string;
  resolvedAt: string | null;
};

export type ApiReviewItem = {
  id: string;
  issue: { id: string; identifier: string; title: string; status: string; autoGate: boolean };
  author: { id: string; name: string } | null;
  run: {
    id: string;
    summary: string | null;
    completedAt: string | null;
    branch: string | null;
    reports: boolean;
  };
  repository: string | null;
  pullRequest: { number: number; url: string | null; branch: string | null; headCommit: string | null } | null;
  delivery: {
    committed: boolean;
    filesChanged: number;
    insertions: number;
    deletions: number;
    files: string[];
    producedFiles: number;
  };
  checks: {
    passed: boolean;
    complete: boolean;
    results: { command: string; exitCode: number | null; passed: boolean }[];
  } | null;
  verdicts: {
    id: string;
    reviewer: string;
    reviewerRole: string | null;
    authority: 'blocking' | 'advisory';
    approved: boolean | null;
    reason: string;
  }[];
  updatedAt: string;
};

export type ApiConversation = {
  id: string;
  kind: string;
  topic: string;
  agentId: string | null;
  agentName: string | null;
  messageCount: number;
  updatedAt: string;
  pinned: boolean;
  archived: boolean;
  unread: number;
  activeRunId: string | null;
  draft: string;
  lastMessage: string | null;
  lastMessageAuthor: 'user' | 'agent' | 'system' | null;
};

export type ApiConversationMessage = {
  id: string;
  authorType: 'user' | 'agent' | 'system';
  authorName: string;
  body: string;
  channel: string;
  createdAt: string;
  runId: string | null;
};

export type ApiPersonalTokenResponse = {
  personalToken: {
    id: string;
    name: string;
    prefix?: string;
    expiresAt?: string | null;
  };
  token?: string;
};
