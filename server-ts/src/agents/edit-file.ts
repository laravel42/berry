/**
 * One exact replacement in a file.
 *
 * `old` must match once, including spaces and line breaks. A miss or a second
 * match is a result the model can read: it reads the file and sends a longer
 * span, rather than writing the whole file again.
 */
export function applyFileEdit(
   content: string,
   old: string,
   replacement: string
): { content: string } | { error: string } {
   if (old === '') return { error: 'old text was empty. Use write_file to create a file or replace it entirely.' };
   const first = content.indexOf(old);
   if (first < 0) {
      return { error: 'old text was not found. Read the file and copy the exact text, including spaces and line breaks.' };
   }
   if (content.indexOf(old, first + old.length) >= 0) {
      return { error: 'old text appears more than once. Include more surrounding lines so it matches once.' };
   }
   return { content: content.slice(0, first) + replacement + content.slice(first + old.length) };
}
