/** How a chat message asks the agent to work. Agent is the ordinary run. */
export const CHAT_MODES = ['agent', 'plan', 'debug', 'multitask', 'ask'] as const;

export type ChatMode = (typeof CHAT_MODES)[number];

export function isChatMode(value: unknown): value is ChatMode {
   return typeof value === 'string' && (CHAT_MODES as readonly string[]).includes(value);
}
