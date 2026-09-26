/**
 * An agent's instructions are one Markdown text, sent as its system prompt.
 * The Instructions tab edits it as sections, each stored under its own `##`
 * heading, so a person knows what kind of guidance goes where.
 *
 * The headings are part of the prompt, so they are fixed English here, not
 * catalogue strings. Role prompts are written under the same headings
 * (`PROMPT_SECTIONS` in server-ts/src/organization/prompt.ts), so a role agent
 * opens with its sections filled in. Text before the first known heading (a
 * prompt written as one block) belongs to Notes; an unknown `##` heading stays
 * inside the section it appears in, so nothing is dropped.
 */
export const INSTRUCTION_SECTIONS = [
   { key: 'role', heading: 'Role' },
   { key: 'context', heading: 'Context' },
   { key: 'approach', heading: 'How to work' },
   { key: 'done', heading: 'Definition of done' },
   { key: 'boundaries', heading: 'Boundaries' },
   { key: 'notes', heading: 'Notes' },
] as const;

export type InstructionSection = (typeof INSTRUCTION_SECTIONS)[number]['key'];

export type InstructionSections = Record<InstructionSection, string>;

const HEADING = /^##\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;

const byHeading = new Map<string, InstructionSection>(
   INSTRUCTION_SECTIONS.map((section) => [section.heading.toLowerCase(), section.key])
);

export function emptyInstructionSections(): InstructionSections {
   return { role: '', context: '', approach: '', done: '', boundaries: '', notes: '' };
}

export function parseInstructions(text: string): InstructionSections {
   const lines: Record<InstructionSection, string[]> = {
      role: [],
      context: [],
      approach: [],
      done: [],
      boundaries: [],
      notes: [],
   };
   let current: InstructionSection = 'notes';
   let fenced = false;
   for (const line of text.split('\n')) {
      if (FENCE.test(line)) fenced = !fenced;
      const match = fenced ? null : HEADING.exec(line);
      const key = match?.[1] ? byHeading.get(match[1].toLowerCase()) : undefined;
      if (key) {
         current = key;
         continue;
      }
      lines[current].push(line);
   }
   const sections = emptyInstructionSections();
   for (const { key } of INSTRUCTION_SECTIONS) sections[key] = lines[key].join('\n').trim();
   return sections;
}

export function composeInstructions(sections: InstructionSections): string {
   return INSTRUCTION_SECTIONS.flatMap(({ key, heading }) => {
      const body = sections[key].trim();
      return body === '' ? [] : [`## ${heading}\n\n${body}`];
   }).join('\n\n');
}

export function sameInstructionSections(a: InstructionSections, b: InstructionSections): boolean {
   return INSTRUCTION_SECTIONS.every(({ key }) => a[key] === b[key]);
}
