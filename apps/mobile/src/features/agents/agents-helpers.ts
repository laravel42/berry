import type { ApiConversation } from '@/api/types';
import type { ActorView } from '@/model/mappers';

export type AgentRosterEntry = {
  agent: ActorView;
  roleLabel: string;
  conversationId: string | null;
  unread: number;
  lastMessage: string | null;
  updatedAt: string | null;
  working: boolean;
};

export function formatAgentRole(roleKey: string | null | undefined): string {
  const cleaned = (roleKey ?? '').replace(/[_-]+/g, ' ').trim();
  if (!cleaned) return 'Agent';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
}

export function buildAgentRoster(
  agents: ActorView[],
  conversations: ApiConversation[],
): AgentRosterEntry[] {
  const convByAgent = new Map<string, ApiConversation>();
  for (const conv of conversations) {
    if (!conv.agentId || conv.archived) continue;
    const prev = convByAgent.get(conv.agentId);
    if (!prev || conv.updatedAt > prev.updatedAt) {
      convByAgent.set(conv.agentId, conv);
    }
  }

  const entries: AgentRosterEntry[] = agents.map((agent) => {
    const conv = convByAgent.get(agent.id) ?? null;
    const working = Boolean(conv?.activeRunId) || agent.status === 'running' || agent.status === 'working';
    return {
      agent,
      roleLabel: formatAgentRole(agent.roleKey),
      conversationId: conv?.id ?? null,
      unread: conv?.unread ?? 0,
      lastMessage: conv?.lastMessage ?? null,
      updatedAt: conv?.updatedAt ?? null,
      working,
    };
  });

  return entries.sort((a, b) => {
    if (a.unread !== b.unread) return b.unread - a.unread;
    if (a.updatedAt && b.updatedAt && a.updatedAt !== b.updatedAt) {
      return b.updatedAt.localeCompare(a.updatedAt);
    }
    if (a.updatedAt && !b.updatedAt) return -1;
    if (!a.updatedAt && b.updatedAt) return 1;
    const aOrch = a.agent.roleKey === 'orchestrator' ? 0 : 1;
    const bOrch = b.agent.roleKey === 'orchestrator' ? 0 : 1;
    if (aOrch !== bOrch) return aOrch - bOrch;
    return a.agent.name.localeCompare(b.agent.name);
  });
}

export function filterAgentRoster(entries: AgentRosterEntry[], query: string): AgentRosterEntry[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter((entry) => {
    const name = entry.agent.name.toLowerCase();
    const role = entry.roleLabel.toLowerCase();
    const desc = (entry.agent.description ?? '').toLowerCase();
    const preview = (entry.lastMessage ?? '').toLowerCase();
    return name.includes(needle) || role.includes(needle) || desc.includes(needle) || preview.includes(needle);
  });
}
