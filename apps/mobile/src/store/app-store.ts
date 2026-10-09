import { create } from 'zustand';

import { ADDABLE_AGENTS, AGENT_REPLIES, PEOPLE, VOICE_TRANSCRIPTS, person } from '@/data/people';
import { CHATS, DUE, ISSUES, NOTIFICATIONS } from '@/data/seed';
import { INITIAL_WEEK, TODAY } from '@/data/seed';
import type {
  Activity,
  CallKind,
  CallSession,
  Chat,
  ChatMessage,
  Issue,
  Notification,
  PersonId,
  Priority,
  Status,
} from '@/model/types';

export type InboxView = 'inbox' | 'archive';
export type MineTab = 'assigned' | 'created';
export type CalFilter = 'all' | 'due' | 'meetings' | 'goals';
export type ChatFilter = 'all' | 'agent' | 'person' | 'thread';

type ToastTimer = ReturnType<typeof setTimeout>;

type AppState = {
  issues: Issue[];
  notifications: Notification[];
  chats: Chat[];
  nextNumber: number;
  toast: string | null;
  inboxView: InboxView;
  onlyNeeds: boolean;
  mineTab: MineTab;
  weekStart: string;
  day: string;
  calFilter: CalFilter;
  chatFilter: ChatFilter;
  typing: string | null;
  call: CallSession | null;
  showToast: (message: string) => void;
  setInboxView: (view: InboxView) => void;
  toggleOnlyNeeds: () => void;
  markAllRead: () => void;
  toggleRead: (id: string) => void;
  setRead: (id: string, read: boolean) => void;
  archiveNotification: (id: string) => void;
  setMineTab: (tab: MineTab) => void;
  setWeek: (start: string, day: string) => void;
  setDay: (day: string) => void;
  setCalFilter: (filter: CalFilter) => void;
  resetCalendar: () => void;
  setChatFilter: (filter: ChatFilter) => void;
  markChatRead: (id: string) => void;
  decide: (issueId: string, patch: Partial<Issue>, entries: Activity[], resolved: string, toast: string) => void;
  comment: (issueId: string, text: string) => void;
  createTask: (input: {
    title: string;
    desc: string;
    assignee: PersonId;
    priority: Priority;
    project: string;
    start: boolean;
  }) => string;
  sendText: (chatId: string, text: string) => void;
  sendVoice: (chatId: string, durationSec: number) => void;
  startChat: (ids: PersonId[]) => string;
  startCall: (kind: CallKind, title: string, people: PersonId[]) => void;
  patchCall: (patch: Partial<CallSession>) => void;
  addAgentToCall: () => string | null;
  endCall: () => number;
};

let toastTimer: ToastTimer | undefined;
let replyCursor = 0;

function nowEntry(who: PersonId, text: string): Activity {
  return { who, text, time: 'now' };
}

function messageId(chatId: string): string {
  return `${chatId}-${Date.now()}-${Math.round(Math.random() * 1e4)}`;
}

export const useApp = create<AppState>((set, get) => ({
  issues: ISSUES.map((issue) => ({ ...issue, due: DUE[issue.id] })),
  notifications: NOTIFICATIONS.map((item) => ({ ...item })),
  chats: CHATS.map((chat) => ({ ...chat, messages: chat.messages.map((message) => ({ ...message })) })),
  nextNumber: 48,
  toast: null,
  inboxView: 'inbox',
  onlyNeeds: false,
  mineTab: 'assigned',
  weekStart: INITIAL_WEEK,
  day: TODAY,
  calFilter: 'all',
  chatFilter: 'all',
  typing: null,
  call: null,

  showToast: (message) => {
    if (toastTimer) clearTimeout(toastTimer);
    set({ toast: message });
    toastTimer = setTimeout(() => set({ toast: null }), 2400);
  },

  setInboxView: (inboxView) => set({ inboxView, onlyNeeds: inboxView === 'archive' ? false : get().onlyNeeds }),
  toggleOnlyNeeds: () => set((state) => ({ onlyNeeds: !state.onlyNeeds })),
  markAllRead: () => {
    set((state) => ({ notifications: state.notifications.map((item) => ({ ...item, read: true })) }));
    get().showToast('Everything marked read');
  },
  toggleRead: (id) =>
    set((state) => ({
      notifications: state.notifications.map((item) => (item.id === id ? { ...item, read: !item.read } : item)),
    })),
  setRead: (id, read) =>
    set((state) => ({
      notifications: state.notifications.map((item) => (item.id === id ? { ...item, read } : item)),
    })),
  archiveNotification: (id) => {
    const current = get().notifications.find((item) => item.id === id);
    if (!current) return;
    set((state) => ({
      notifications: state.notifications.map((item) =>
        item.id === id ? { ...item, archived: !item.archived } : item,
      ),
    }));
    get().showToast(current.archived ? 'Moved back to inbox' : 'Archived');
  },
  setMineTab: (mineTab) => set({ mineTab }),
  setWeek: (weekStart, day) => set({ weekStart, day }),
  setDay: (day) => set({ day }),
  setCalFilter: (calFilter) => set({ calFilter }),
  resetCalendar: () => set({ weekStart: INITIAL_WEEK, day: TODAY }),
  setChatFilter: (chatFilter) => set({ chatFilter }),
  markChatRead: (id) =>
    set((state) => ({
      chats: state.chats.map((chat) => (chat.id === id ? { ...chat, unread: 0 } : chat)),
    })),

  decide: (issueId, patch, entries, resolved, toast) => {
    set((state) => ({
      issues: state.issues.map((issue) =>
        issue.id === issueId
          ? { ...issue, ...patch, resolved, activity: [...issue.activity, ...entries] }
          : issue,
      ),
      notifications: state.notifications.map((item) =>
        item.issue === issueId ? { ...item, needs: false, read: true } : item,
      ),
    }));
    get().showToast(toast);
  },

  comment: (issueId, text) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    set((state) => ({
      issues: state.issues.map((issue) =>
        issue.id === issueId
          ? { ...issue, activity: [...issue.activity, nowEntry('me', `commented: “${trimmed}”`)] }
          : issue,
      ),
    }));
  },

  createTask: ({ title, desc, assignee, priority, project, start }) => {
    const id = String(get().nextNumber);
    const starting = person(assignee).agent && start;
    const activity: Activity[] = [
      nowEntry('me', 'created this task'),
      nowEntry('me', `assigned ${assignee === 'me' ? 'themself' : person(assignee).name}`),
    ];
    if (starting) activity.push(nowEntry('berry', `started a run for ${person(assignee).name}`));
    const status: Status = starting ? 'in_progress' : person(assignee).agent ? 'backlog' : 'todo';
    const issue: Issue = {
      id,
      title: title || 'Untitled',
      status,
      priority,
      assignee,
      createdBy: 'me',
      project,
      desc,
      activity,
    };
    set((state) => ({
      issues: [issue, ...state.issues],
      nextNumber: state.nextNumber + 1,
      mineTab: assignee === 'me' ? 'assigned' : 'created',
    }));
    get().showToast(
      `BERR-${id}${starting ? ` created · ${person(assignee).name} started` : ' created'}`,
    );
    return id;
  },

  sendText: (chatId, text) => {
    const trimmed = text.trim();
    const chat = get().chats.find((item) => item.id === chatId);
    if (!trimmed || !chat) return;
    const message: ChatMessage = { id: messageId(chatId), from: 'me', text: trimmed, time: 'Now' };
    set((state) => ({
      chats: state.chats.map((item) =>
        item.id === chatId ? { ...item, messages: [...item.messages, message] } : item,
      ),
    }));
    queueAgentReply(chat);
  },

  sendVoice: (chatId, durationSec) => {
    const chat = get().chats.find((item) => item.id === chatId);
    if (!chat) return;
    const id = messageId(chatId);
    const message: ChatMessage = {
      id,
      from: 'me',
      voice: { dur: Math.max(1, durationSec) },
      transcribing: true,
      time: 'Now',
    };
    set((state) => ({
      chats: state.chats.map((item) =>
        item.id === chatId ? { ...item, messages: [...item.messages, message] } : item,
      ),
    }));
    const who = chat.who;
    setTimeout(() => {
      set((state) => ({
        chats: state.chats.map((item) =>
          item.id === chatId
            ? {
                ...item,
                messages: item.messages.map((entry) =>
                  entry.id === id
                    ? {
                        ...entry,
                        transcribing: false,
                        transcript: (who && VOICE_TRANSCRIPTS[who]) || 'Quick one: can you look at this before lunch?',
                      }
                    : entry,
                ),
              }
            : item,
        ),
      }));
      queueAgentReply(chat);
    }, 1200);
  },

  startChat: (ids) => {
    if (ids.length === 1) {
      const who = ids[0];
      if (!who) return '';
      const found = get().chats.find((chat) => chat.type !== 'thread' && chat.type !== 'group' && chat.who === who);
      if (found) return found.id;
      const agent = person(who).agent;
      const chat: Chat = {
        id: who,
        type: agent ? 'agent' : 'person',
        who,
        presence: agent ? 'idle' : 'online',
        status: agent ? 'Idle' : 'Online',
        unread: 0,
        messages: [],
      };
      set((state) => ({ chats: [chat, ...state.chats] }));
      return who;
    }
    const id = `g${Date.now()}`;
    const chat: Chat = {
      id,
      type: 'group',
      people: ['me', ...ids],
      status: `${ids.map((item) => person(item).name).join(', ')}, you`,
      unread: 0,
      messages: [],
    };
    set((state) => ({ chats: [chat, ...state.chats] }));
    return id;
  },

  startCall: (kind, title, people) =>
    set({
      call: {
        kind,
        title,
        people,
        start: Date.now(),
        muted: false,
        cam: kind === 'video',
        speaker: false,
      },
    }),

  patchCall: (patch) =>
    set((state) => (state.call ? { call: { ...state.call, ...patch } } : state)),

  addAgentToCall: () => {
    const call = get().call;
    if (!call) return null;
    const next = ADDABLE_AGENTS.find((id) => !call.people.includes(id));
    if (!next) {
      get().showToast('Every agent is already on the call');
      return null;
    }
    set({ call: { ...call, people: [...call.people, next] } });
    get().showToast(`${person(next).name} joined the call`);
    return next;
  },

  endCall: () => {
    const call = get().call;
    const elapsed = call ? (Date.now() - call.start) / 1000 : 0;
    set({ call: null });
    return Math.max(0, elapsed);
  },
}));

function queueAgentReply(chat: Chat) {
  if (chat.type !== 'agent' || !chat.who) return;
  const who = chat.who;
  useApp.setState({ typing: chat.id });
  setTimeout(() => {
    const replies = AGENT_REPLIES[who] ?? AGENT_REPLIES.se ?? [];
    replyCursor += 1;
    const text = replies[replyCursor % replies.length] ?? 'Noted.';
    const message: ChatMessage = { id: messageId(chat.id), from: who, text, time: 'Now' };
    useApp.setState((state) => ({
      typing: state.typing === chat.id ? null : state.typing,
      chats: state.chats.map((item) =>
        item.id === chat.id ? { ...item, messages: [...item.messages, message] } : item,
      ),
    }));
  }, 1500);
}

export function unreadInboxCount(notifications: Notification[]): number {
  return notifications.filter((item) => !item.archived && !item.read).length;
}

export function chatUnreadCount(chats: Chat[]): number {
  return chats.reduce((total, chat) => total + (chat.unread > 0 ? 1 : 0), 0);
}
