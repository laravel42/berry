/**
 * What the LiveKit worker reads from job metadata: who is speaking, and
 * enough of the Berry chat to stay in the same conversation.
 */

export interface VoiceBrief {
   name: string;
   memberName: string;
   instructions: string;
}

const MAX_INSTRUCTIONS = 3500;
const MAX_TURN = 280;
const MAX_TURNS = 10;

export function voiceBrief(input: {
   agentName: string;
   memberName: string;
   mission?: string | null;
   prompt?: string | null;
   transcript?: { author: string; body: string }[];
}): VoiceBrief {
   const name = input.agentName.trim() || 'the workspace agent';
   const memberName = input.memberName.trim() || 'there';
   const mission = (input.mission ?? '').trim();
   const prompt = (input.prompt ?? '').trim();
   const turns = (input.transcript ?? [])
      .slice(-MAX_TURNS)
      .map((turn) => `${turn.author}: ${clip(turn.body, MAX_TURN)}`)
      .filter((line) => line.length > 2);
   const parts = [
      `You are ${name} on a live voice call in Berry.`,
      mission || null,
      prompt ? clip(prompt, 1600) : null,
      'Keep replies to a few spoken sentences. Do not invent repository facts. You cannot mark work done or cancelled; a person decides release.',
      `The member is ${memberName}.`,
      turns.length > 0 ? `Recent chat:\n${turns.join('\n')}` : null,
   ].filter((part): part is string => Boolean(part));
   return {
      name,
      memberName,
      instructions: clip(parts.join('\n\n'), MAX_INSTRUCTIONS),
   };
}

function clip(value: string, max: number): string {
   const text = value.trim();
   if (text.length <= max) return text;
   return `${text.slice(0, max - 1).trimEnd()}…`;
}
