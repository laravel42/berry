'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { useEffect, useState } from 'react';

/**
 * The preview in the review pane.
 *
 * A preview host is a different origin on loopback. Chrome will not navigate
 * a frame from Berry to that host — the pane stays white — while opening the
 * same address in a window works. So this loads the page from Berry (that
 * fetch is allowed), inlines its own scripts and styles, and shows the
 * result in a sandboxed srcDoc. The sandbox has no same-origin, so the
 * page cannot act as Berry. A site that is already on Berry's origin is
 * framed at its address, sandboxed the same way.
 */
export function PreviewFrame({
   src,
   title,
   reload = 0,
   sandboxed = false,
}: {
   src: string;
   title: string;
   reload?: number;
   /** A plain page on Berry's origin: no way to act as Berry. */
   sandboxed?: boolean;
}) {
   const href = frameSrc(src, reload);
   const [doc, setDoc] = useState<string | null>(null);
   const [phase, setPhase] = useState<'wait' | 'doc' | 'frame'>('wait');

   useEffect(() => {
      let cancelled = false;
      setPhase('wait');
      setDoc(null);
      if (sandboxed) {
         setPhase('frame');
         return;
      }
      void inlinePreview(href).then((next) => {
         if (cancelled) return;
         if (next) {
            setDoc(next);
            setPhase('doc');
         } else {
            setPhase('frame');
         }
      });
      return () => {
         cancelled = true;
      };
   }, [href, sandboxed]);

   if (phase === 'wait') {
      return (
         <div className="flex size-full items-center justify-center">
            <BerryMark size="md" tone="brand" pulse />
         </div>
      );
   }

   if (phase === 'doc' && doc) {
      return (
         <iframe
            key={href}
            srcDoc={doc}
            title={title}
            sandbox="allow-scripts allow-forms allow-popups allow-modals allow-pointer-lock"
            className="size-full border-0 bg-white"
            allow="clipboard-write"
         />
      );
   }

   return (
      <iframe
         key={href}
         src={href}
         title={title}
         {...(sandboxed ? { sandbox: 'allow-scripts allow-forms allow-popups allow-modals' } : {})}
         referrerPolicy="no-referrer"
         className="size-full border-0 bg-white"
         allow="clipboard-write; local-network-access *; loopback-network *; local-network *"
      />
   );
}

/** Reload must change the address. The browser will not retry a URL it already refused. */
function frameSrc(src: string, reload: number): string {
   if (reload === 0) return src;
   try {
      const url = new URL(src);
      url.searchParams.set('berry-preview', String(reload));
      return url.toString();
   } catch {
      const join = src.includes('?') ? '&' : '?';
      return `${src}${join}berry-preview=${reload}`;
   }
}

/**
 * A Vite (or similarly small) page as one document: its CSS and entry
 * scripts fetched from Berry, then inlined. A Next app with many chunks
 * is left to the real address.
 */
async function inlinePreview(href: string): Promise<string | null> {
   try {
      const page = await fetch(href, {
         cache: 'no-store',
         redirect: 'manual',
         signal: AbortSignal.timeout(5_000),
      });
      if (page.status >= 500) return null;
      const type = (page.headers.get('content-type') ?? '').toLowerCase();
      if (!type.includes('text/html')) return null;
      const html = await page.text();
      const origin = new URL(href).origin;
      const scripts = [...html.matchAll(/<script\b([^>]*)>\s*<\/script>/gi)];
      const remote = scripts.filter((match) => /\ssrc\s*=/i.test(match[1] ?? ''));
      if (remote.length === 0 || remote.length > 4) return null;
      let out = html;
      for (const link of html.matchAll(/<link\b([^>]*)>/gi)) {
         const attrs = link[1] ?? '';
         if (!/\bstylesheet\b/i.test(attrs) && !/\.css(?:["']|$)/i.test(attrs)) continue;
         const src = /href\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
         if (!src) continue;
         const css = await fetch(new URL(src, `${origin}/`).href, {
            cache: 'no-store',
            signal: AbortSignal.timeout(5_000),
         });
         const cssHref = css.ok ? dataUrl('text/css', await css.text()) : '';
         out = out.replace(link[0], `<link rel="stylesheet" href="${cssHref}">`);
      }
      for (const script of remote) {
         const attrs = script[1] ?? '';
         const src = /src\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
         if (!src) continue;
         const js = await fetch(new URL(src, `${origin}/`).href, {
            cache: 'no-store',
            signal: AbortSignal.timeout(8_000),
         });
         if (!js.ok) return null;
         const module = /\btype\s*=\s*["']module["']/i.test(attrs) ? ' type="module"' : '';
         out = out.replace(
            script[0],
            `<script${module} src="${dataUrl('text/javascript', await js.text())}"></script>`
         );
      }
      return out;
   } catch {
      return null;
   }
}

function dataUrl(type: string, text: string): string {
   return `data:${type};charset=utf-8,${encodeURIComponent(text)}`;
}
