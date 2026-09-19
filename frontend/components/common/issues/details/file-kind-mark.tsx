/** Compact extension mark the way Cursor's breadcrumb shows `TS` before the file. */
export function FileKindMark({ name }: { name: string }) {
   const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
   const mark = (() => {
      switch (ext) {
         case 'ts':
         case 'mts':
         case 'cts':
            return { label: 'TS', color: '#c47b3a' };
         case 'tsx':
            return { label: 'TS', color: '#4fc1ff' };
         case 'js':
         case 'mjs':
         case 'cjs':
            return { label: 'JS', color: '#cbcb41' };
         case 'jsx':
            return { label: 'JS', color: '#61dafb' };
         case 'json':
         case 'jsonc':
            return { label: '{}', color: '#cbcb41' };
         case 'css':
         case 'scss':
         case 'sass':
            return { label: '#', color: '#ce9178' };
         case 'html':
         case 'htm':
            return { label: '<>', color: '#e44d26' };
         case 'md':
         case 'mdx':
            return { label: 'MD', color: '#519aba' };
         case 'py':
            return { label: 'PY', color: '#3572a5' };
         case 'yml':
         case 'yaml':
            return { label: 'Y', color: '#cb171e' };
         case 'svg':
            return { label: 'SVG', color: '#ffb13b' };
         default:
            return ext ? { label: ext.slice(0, 3).toUpperCase(), color: 'var(--brand-ash)' } : null;
      }
   })();
   if (!mark) return null;
   return (
      <span
         aria-hidden
         className="inline-flex w-5 shrink-0 justify-center font-semibold tracking-tight"
         style={{ fontSize: '9px', color: mark.color, lineHeight: 1 }}
      >
         {mark.label}
      </span>
   );
}
