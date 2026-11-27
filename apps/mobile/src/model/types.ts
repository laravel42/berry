export type NotifKind =
  | 'review'
  | 'approval'
  | 'failed'
  | 'blocked'
  | 'mention'
  | 'assigned'
  | 'done';

export type Tone = 'neutral' | 'working' | 'attention' | 'complete' | 'danger';
