/**
 * A skill a person named in a chat message, and how that message tells the
 * agent to follow it.
 *
 * The token is `/name` at the start of the message or after a space, and the
 * name is a workspace skill name. A path such as `frontend/components` is not
 * one: the slash there is not preceded by the start of the text or a space.
 */

const SKILL_TOKEN = /(?:^|\s)\/([a-z0-9][a-z0-9-]{0,63})(?=\s|$)/g;

/** Skill names written as `/name` in a chat message, once each, in order. */
export function invokedSkillNames(body: string): string[] {
   const names: string[] = [];
   for (const match of body.matchAll(SKILL_TOKEN)) {
      const name = match[1];
      if (name && !names.includes(name)) names.push(name);
   }
   return names;
}

/**
 * Appended to a chat prompt when the message names skills. The agent already
 * carries optional skills; these ones were chosen for this answer, so their
 * text is in the prompt and the answer has to follow them.
 */
export function requiredSkillsContract(
   skills: Array<{ name: string; description: string; content: string }>
): string {
   const blocks = skills.map((skill) => {
      const description = skill.description.replace(/\s+/g, ' ').trim();
      return (
         `Skill ${skill.name}: ${description}\n` +
         `Follow this skill for the answer. Its other files, if any, are at ` +
         `.berry/skills/${skill.name}/ and can be read with read_skill.\n` +
         `<skill name="${skill.name}">\n${skill.content.trim()}\n</skill>`
      );
   });
   return (
      '\n\nSkills required for this answer\n' +
      'The person invoked these skills in the message. The answer has to come from that skill.\n\n' +
      blocks.join('\n\n') +
      '\n'
   );
}
