import { readFile, writeFile, mkdir, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const out = path.join(here, 'dist');
const pages = JSON.parse(await readFile(path.join(here, 'pages.json'), 'utf8'));
const repo = 'https://github.com/laravel42/berry-circle/blob/main/';
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const slug = (s) => s.toLowerCase().replace(/<[^>]*>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const groups = [...new Set(pages.map(p => p.group))];
const sourceRoutes = new Map(pages.filter(p => p.source && !p.section).map(p => [p.source, p.slug + '.html']));
const mark = '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 8H8v48h6M50 8h6v48h-6" fill="none" stroke="currentColor" stroke-width="6"/><circle cx="32" cy="32" r="13" fill="var(--accent)"/></svg>';
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await mkdir(path.join(out, 'sources'), { recursive: true });
await cp(path.join(here, 'assets'), path.join(out, 'assets'), { recursive: true });
const search = [];
for (const [index, page] of pages.entries()) {
  const source = page.source || `documentation/content/${page.slug}.md`;
  let md = await readFile(path.join(root, source), 'utf8');
  if (page.section) {
    const start = md.indexOf(`## ${page.section}`);
    if (start < 0) throw new Error(`Missing section: ${page.section}`);
    const end = md.indexOf('\n## ', start + 3);
    md = md.slice(start, end < 0 ? undefined : end).replace(/^## .*\n/, '');
    md = md.replace(/^### /gm, '## ').replace(/^#### /gm, '### ');
  } else md = md.replace(/^# [^\n]*\n/, '');
  const toc = [], ids = new Map();
  const parser = new Marked({ gfm: true, renderer: {
    html({text}) { return esc(text); },
    heading({tokens, depth}) {
      const text = this.parser.parseInline(tokens);
      const base = slug(text); const n = ids.get(base) || 0; ids.set(base, n + 1);
      const id = base + (n ? `-${n}` : '');
      if (depth === 2) toc.push({ id, text });
      return `<h${depth} id="${id}">${text}<a class="anchor" href="#${id}" aria-label="Link to section">#</a></h${depth}>`;
    },
    link({href, tokens, title}) {
      let url = href;
      // The maintained API document's short legacy anchor points to this heading.
      if (source === 'docs/api/gateway-v1.md' && url === '#organization') url = '#organization-route-table-only';
      if (/^(javascript|data|vbscript):/i.test(url)) url = '#';
      if (url.startsWith('#') && page.section) url = `${repo}${source}${url}`;
      else if (!/^(https?:|mailto:|#)/.test(url) && !url.endsWith('.html') && !url.includes('.html#')) {
        const [file, hash] = url.split('#');
        const relative = path.posix.normalize(path.posix.join(path.posix.dirname(source), file));
        url = sourceRoutes.get(relative) ? sourceRoutes.get(relative) + (hash ? '#' + hash : '') : repo + relative + (hash ? '#' + hash : '');
      }
      return `<a href="${esc(url)}"${title ? ` title="${esc(title)}"` : ''}>${this.parser.parseInline(tokens)}</a>`;
    }
  }});
  const body = parser.parse(md);
  await writeFile(path.join(out, 'sources', page.slug + '.md'), `# ${page.title}\n\n${md}`);
  search.push({ title: page.title, group: page.group, url: page.slug + '.html', description: page.description, text: md.replace(/[`#*\[\]>|]/g, ' ').replace(/\s+/g, ' ') });
  const nav = groups.map(group => `<section class="nav-group"><h2>${esc(group)}</h2>${pages.filter(p => p.group === group).map(p => `<a href="${p.slug}.html"${p.slug === page.slug ? ' aria-current="page"' : ''}>${esc(p.title)}</a>`).join('')}</section>`).join('');
  const hero = page.slug === 'index' ? `<div class="path-grid"><a href="quickstart.html"><span>01 / START</span><h2>Run your first workspace <b>↗</b></h2><p>Install Berry and learn the core workflow.</p></a><a href="planning.html"><span>02 / PLAN</span><h2>Turn ideas into work <b>↗</b></h2><p>Connect Projects, Goals, tasks, and agents.</p></a><a href="runtime.html"><span>03 / OPERATE</span><h2>Connect an agent runtime <b>↗</b></h2><p>Understand execution and troubleshoot it.</p></a><a href="api.html"><span>04 / BUILD</span><h2>Extend your workspace <b>↗</b></h2><p>Explore the API, integrations, and plugins.</p></a></div>` : '';
  const prev = pages[index - 1], next = pages[index + 1];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(page.title)} · Berry Docs</title><meta name="description" content="${esc(page.description)}"><meta name="color-scheme" content="light dark"><link rel="icon" href="assets/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="assets/style.css"><script src="assets/theme.js"></script><script src="assets/site.js" defer></script></head><body>
<noscript><style>@media(max-width:760px){#sidebar{display:block;position:static;width:100%;height:auto;box-shadow:none}.menu-button,.search-trigger,.theme-button{display:none}}</style></noscript>
<a class="skip" href="#content">Skip to content</a><header><a class="brand" href="index.html">${mark}<strong>berry<i>.</i></strong><span> / docs</span></a><nav aria-label="Top navigation"><a class="top-active" href="index.html">Documentation</a><a href="api.html">API reference</a></nav><div class="header-actions"><button class="search-trigger" aria-label="Search documentation">⌕ <span>Search documentation</span><kbd>⌘ K</kbd></button><button class="theme-button" aria-label="Toggle color theme">◐</button><a class="repo-link" href="https://github.com/laravel42/berry-circle">GitHub ↗</a><button class="menu-button" aria-expanded="false" aria-controls="sidebar" aria-label="Toggle navigation">☰</button></div></header>
<div class="layout"><aside id="sidebar"><div class="edition"><span class="edition-dot"></span> Berry handbook <small>Self-hosted</small></div>${nav}<a class="nav-footer" href="contributing.html">Help improve these docs ↗</a></aside><main id="content"><div class="eyebrow">${esc(page.group)}<span> / ${esc(page.title)}</span></div><h1>${esc(page.title)}</h1><p class="lead">${esc(page.description)}</p>${hero}<article>${body}</article><div class="source-note">${page.section ? 'Product guide, included from the maintained repository documentation.' : 'Documentation for the current repository checkout.'} <a href="sources/${page.slug}.md">View Markdown source ↗</a></div><nav class="pagination" aria-label="Documentation pages">${prev ? `<a href="${prev.slug}.html"><small>← Previous</small>${esc(prev.title)}</a>` : '<span></span>'}${next ? `<a href="${next.slug}.html"><small>Next →</small>${esc(next.title)}</a>` : ''}</nav><footer>Berry · Work together. Keep people in control.<span>MIT licensed</span></footer></main><aside class="toc"><p>On this page</p>${toc.map(t => `<a href="#${t.id}">${t.text}</a>`).join('')}<div class="toc-help">Something unclear?<a href="troubleshooting.html">Troubleshooting ↗</a><a href="sources/${page.slug}.md">View Markdown source ↗</a></div></aside></div>
<dialog id="search-dialog" aria-labelledby="search-title"><div class="search-heading"><h2 id="search-title">Search Berry docs</h2><button id="close-search" aria-label="Close search">Esc</button></div><input id="search-input" type="search" placeholder="Try ‘runtime’, ‘goals’, or ‘API tokens’" aria-label="Search documentation" autocomplete="off"><p id="search-status" role="status"></p><div id="search-results"></div></dialog></body></html>`;
  await writeFile(path.join(out, page.slug + '.html'), html);
}
await writeFile(path.join(out, 'search-index.json'), JSON.stringify(search));
await writeFile(path.join(out, '404.html'), '<!doctype html><html lang="en"><meta charset="utf-8"><title>Page not found · Berry Docs</title><link rel="stylesheet" href="assets/style.css"><main><h1>Page not found</h1><p>This documentation page does not exist.</p><a href="index.html">Return to Berry documentation</a></main></html>');
console.log(`Built ${pages.length} pages in documentation/dist`);
