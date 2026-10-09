export type PersonId =
  | 'me'
  | 'lena'
  | 'se'
  | 'pd'
  | 'qa'
  | 'ops'
  | 'orch'
  | 'berry'
  | 'none';

export type Status =
  | 'in_review'
  | 'in_progress'
  | 'todo'
  | 'blocked'
  | 'backlog'
  | 'done';

export type Priority = 'none' | 'low' | 'medium' | 'high' | 'urgent';

export type Decision = 'review' | 'approval' | 'failed' | 'question';

export type NotifKind =
  | 'review'
  | 'approval'
  | 'failed'
  | 'blocked'
  | 'mention'
  | 'assigned'
  | 'done';

export type Tone = 'neutral' | 'working' | 'attention' | 'complete' | 'danger';

export type Activity = {
  who: PersonId;
  text: string;
  time: string;
};

export type PullRequest = {
  num: string;
  branch: string;
  files: number;
  add: number;
  del: number;
  checks: string;
};

export type Issue = {
  id: string;
  title: string;
  status: Status;
  priority: Priority;
  assignee: PersonId;
  createdBy: PersonId;
  project: string;
  desc: string;
  decision?: Decision;
  resolved?: string;
  pr?: PullRequest;
  qa?: string;
  handoff?: string;
  approval?: string;
  failure?: string;
  question?: string;
  options?: string[];
  activity: Activity[];
  due?: string;
};

export type Notification = {
  id: string;
  issue: string;
  kind: NotifKind;
  body: string;
  time: string;
  read: boolean;
  needs: boolean;
  archived: boolean;
};

export type ChatType = 'agent' | 'person' | 'group' | 'thread';

export type Presence = 'working' | 'blocked' | 'online' | 'idle';

export type VoiceNote = {
  dur: number;
};

export type ChatMessage = {
  id: string;
  from: PersonId;
  text?: string;
  voice?: VoiceNote;
  transcribing?: boolean;
  transcript?: string;
  ref?: string;
  time: string;
};

export type Chat = {
  id: string;
  type: ChatType;
  who?: PersonId;
  issue?: string;
  people?: PersonId[];
  presence?: Presence;
  status: string;
  unread: number;
  messages: ChatMessage[];
};

export type Meeting = {
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
  people: PersonId[];
};

export type Goal = {
  date: string;
  title: string;
  plan: string;
  done: number;
  total: number;
};

export type CallKind = 'audio' | 'video';

export type CallSession = {
  kind: CallKind;
  title: string;
  people: PersonId[];
  start: number;
  muted: boolean;
  cam: boolean;
  speaker: boolean;
};
