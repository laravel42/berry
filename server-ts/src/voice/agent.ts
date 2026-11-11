/**
 * LiveKit Cloud worker for Berry voice rooms.
 *
 * Dispatch name: LIVEKIT_AGENT_NAME, or berry-voice. Job metadata is minted
 * by POST /api/v1/voice/token (name, memberName, instructions, plus ids).
 *
 * Models are LiveKit Inference — the same LIVEKIT_* credentials, no extra
 * provider keys. Run: `pnpm dev:voice` from the repo root.
 */
import { type JobContext, ServerOptions, cli, defineAgent, inference, voice } from '@livekit/agents';
import { fileURLToPath } from 'node:url';

type VoiceJob = {
   name: string;
   memberName: string;
   instructions: string;
};

function readJob(ctx: JobContext): VoiceJob {
   try {
      const parsed = JSON.parse(ctx.job.metadata || '{}') as Record<string, unknown>;
      const instructions =
         typeof parsed['instructions'] === 'string' ? parsed['instructions'].trim() : '';
      return {
         name:
            typeof parsed['name'] === 'string' && parsed['name'].trim()
               ? parsed['name']
               : 'the workspace agent',
         memberName:
            typeof parsed['memberName'] === 'string' && parsed['memberName'].trim()
               ? parsed['memberName']
               : 'there',
         instructions:
            instructions ||
            'You are a Berry workspace agent on a live voice call. Keep replies short. Do not invent facts. You cannot mark work done or cancelled.',
      };
   } catch {
      return {
         name: 'the workspace agent',
         memberName: 'there',
         instructions:
            'You are a Berry workspace agent on a live voice call. Keep replies short. Do not invent facts. You cannot mark work done or cancelled.',
      };
   }
}

export default defineAgent({
   entry: async (ctx: JobContext) => {
      const job = readJob(ctx);
      const session = new voice.AgentSession({
         stt: new inference.STT({ model: 'assemblyai/universal-streaming', language: 'en' }),
         llm: new inference.LLM({ model: 'google/gemma-4-31b-it' }),
         tts: new inference.TTS({
            model: 'fishaudio/s2.1-pro',
            voice: 'fa4c9eb3dccc4806b382b40d61c6b10a',
         }),
         turnHandling: {
            turnDetection: 'stt',
         },
         userAwayTimeout: null,
      });
      await session.start({
         agent: voice.Agent.create({ instructions: job.instructions }),
         room: ctx.room,
      });
      await session.generateReply({
         instructions: `Greet ${job.memberName} briefly as ${job.name} and ask how you can help.`,
      });
   },
});

cli.runApp(
   new ServerOptions({
      agent: fileURLToPath(import.meta.url),
      agentName: process.env['LIVEKIT_AGENT_NAME']?.trim() || 'berry-voice',
   })
);
