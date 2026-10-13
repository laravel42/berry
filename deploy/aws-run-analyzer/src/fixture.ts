import { BUNDLE_VERSION, type RunBundle, type RunEvent } from './bundle.ts';

/** A small Kiro run: a refused built-in, a failing command, a long silence, then a failure. */
export function sampleBundle(overrides: Partial<RunBundle['run']> = {}): RunBundle {
   const t = (seconds: number) => new Date(Date.UTC(2026, 9, 12, 12, 0, seconds)).toISOString();
   const events: RunEvent[] = [
      { sequence: 1, type: 'run.started', at: t(0), payload: { startedAt: t(0) } },
      { sequence: 2, type: 'run.output.delta', at: t(1), payload: { text: 'I will ', channel: 'assistant' } },
      { sequence: 3, type: 'run.output.delta', at: t(1), payload: { text: 'edit the file.', channel: 'assistant' } },
      { sequence: 4, type: 'run.tool.started', at: t(2), payload: { name: 'Replace in File', toolCallId: 'a', inputSummary: null } },
      { sequence: 5, type: 'run.tool.completed', at: t(2), payload: { status: 'failed', durationMs: 0, toolCallId: 'a', outputSummary: null } },
      { sequence: 6, type: 'run.tool.started', at: t(3), payload: { name: 'Replace in File', toolCallId: 'b', inputSummary: null } },
      { sequence: 7, type: 'run.tool.completed', at: t(3), payload: { status: 'failed', durationMs: 0, toolCallId: 'b', outputSummary: null } },
      { sequence: 8, type: 'run.tool.started', at: t(4), payload: { name: 'Replace in File', toolCallId: 'c', inputSummary: null } },
      { sequence: 9, type: 'run.tool.completed', at: t(4), payload: { status: 'failed', durationMs: 0, toolCallId: 'c', outputSummary: null } },
      { sequence: 10, type: 'run.command.started', at: t(5), payload: { command: 'npm test', commandId: 'x', cwd: '/w/repo' } },
      { sequence: 11, type: 'run.command.output', at: t(6), payload: { text: 'FAIL src/a.test.ts\nExpected 1, got 2\n', commandId: 'x' } },
      { sequence: 12, type: 'run.command.completed', at: t(185), payload: { command: 'npm test', commandId: 'x', exitCode: 1, durationMs: 180_000 } },
      { sequence: 13, type: 'run.output.delta', at: t(500), payload: { text: 'Tests still fail.', channel: 'assistant' } },
      { sequence: 14, type: 'run.failed', at: t(501), payload: { failure: { code: 'RUNTIME_ERROR', message: 'gave up', retryable: false } } },
   ];
   return {
      version: BUNDLE_VERSION,
      exportedAt: t(600),
      run: {
         id: 'run-1',
         kind: 'agent',
         source: 'assignment',
         status: 'failed',
         createdAt: t(0),
         startedAt: t(0),
         completedAt: t(501),
         failure: { code: 'RUNTIME_ERROR', message: 'gave up', retryable: false },
         summary: null,
         usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, costMicros: null, currency: null },
         ...overrides,
      },
      task: { id: 'issue-1', identifier: 'BER-7', title: 'Fix the score', description: 'The score doubles.', workspace: 'Berry', board: 'Game' },
      agent: {
         id: 'agent-1',
         name: 'Software Engineer',
         role: 'software-engineer',
         tier: 'berry_mid',
         provider: 'kiro',
         model: 'auto',
         allowedTools: ['read_task', 'write_file', 'run_command'],
      },
      events,
   };
}
