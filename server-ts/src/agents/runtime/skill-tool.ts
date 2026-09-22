import { tool, type Tool } from '@strands-agents/sdk';
import { z } from 'zod';

/**
 * A skill's text, on request.
 *
 * The skills are already written into the workspace, but a role without a
 * shell could not open them and a role with one was never told to. This reads
 * from the envelope the runtime was handed, so it works for every level and
 * costs no command. The prompt names the skills and says to read one before
 * work it applies to.
 */
export function readSkillTool(skills: Array<{ name: string; files: Array<{ path: string; content: string }> }>): Tool {
   const names = skills.map((skill) => skill.name);
   return tool({
      name: 'read_skill',
      description:
         'Read one of the skills you carry, by name, and follow it for the work it applies to. ' +
         (names.length > 0 ? `Your skills: ${names.join(', ')}.` : 'You carry no skills.'),
      inputSchema: z.object({
         name: z.string().describe('The skill, as named in the prompt'),
         file: z.string().optional().describe('A file of the skill other than SKILL.md, by its path'),
      }),
      callback: async ({ name, file }) => {
         const skill = skills.find((candidate) => candidate.name === name.trim());
         if (!skill) return { found: false, error: `No skill named ${name}. Your skills: ${names.join(', ') || 'none'}.` };
         const path = file?.trim() || 'SKILL.md';
         const entry = skill.files.find((candidate) => candidate.path === path);
         if (!entry) return { found: false, name: skill.name, error: `${skill.name} has no file ${path}.`, files: skill.files.map((candidate) => candidate.path) };
         return { found: true, name: skill.name, path, content: entry.content, files: skill.files.map((candidate) => candidate.path) };
      },
   });
}
