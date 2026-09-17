const dialog = document.querySelector('#search-dialog');
const input = document.querySelector('#search-input');
const results = document.querySelector('#search-results');
const status = document.querySelector('#search-status');
let entries;
let openingButton;
async function search() {
  results.replaceChildren();
  if (!entries) { status.textContent = 'Loading search…'; return; }
  const query = input.value.trim().toLowerCase();
  if (!query) { status.textContent = 'Search guides, configuration, and API reference.'; return; }
  const terms = query.split(/\s+/);
  const matches = entries.map(page => ({ page, score: terms.reduce((n, term) => n + (page.title.toLowerCase().includes(term) ? 12 : 0) + (page.description.toLowerCase().includes(term) ? 4 : 0) + (page.text.toLowerCase().includes(term) ? 1 : 0), 0) })).filter(({page}) => terms.every(t => `${page.title} ${page.description} ${page.text}`.toLowerCase().includes(t))).sort((a,b) => b.score - a.score).slice(0, 20);
  status.textContent = matches.length ? `${matches.length} results` : `No results for “${input.value}”. Try a different term.`;
  for (const {page} of matches) {
    const link = document.createElement('a'); link.href = page.url;
    const group = document.createElement('small'); group.textContent = page.group;
    const title = document.createElement('strong'); title.textContent = page.title;
    const text = document.createElement('p'); text.textContent = page.description;
    link.append(group,title,text); results.append(link);
  }
}
async function openSearch() {
  if (dialog.open) return;
  openingButton = document.activeElement; dialog.showModal(); input.focus();
  if (!entries) {
    status.textContent = 'Loading search…';
    try { const response = await fetch('search-index.json'); if (!response.ok) throw new Error(); entries = await response.json(); }
    catch { status.textContent = 'Search could not load. Use the navigation or reload this page.'; return; }
  }
  search();
}
document.querySelector('.search-trigger').addEventListener('click', openSearch);
document.querySelector('#close-search').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => openingButton?.focus());
dialog.addEventListener('click', event => { if (event.target === dialog) { const r=dialog.getBoundingClientRect(); if (event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom) dialog.close(); } });
input.addEventListener('input', search);
input.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); results.querySelector('a')?.focus(); } if(event.key === 'Enter') results.querySelector('a')?.click(); });
results.addEventListener('keydown', event => { const links=[...results.querySelectorAll('a')];const index=links.indexOf(document.activeElement);if(event.key==='ArrowDown'){event.preventDefault();links[(index+1)%links.length]?.focus();}if(event.key==='ArrowUp'){event.preventDefault();if(index===0)input.focus();else links[index-1]?.focus();} });
document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch(); } });
document.querySelector('.theme-button').addEventListener('click', () => { const value = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = value; try { localStorage.setItem('berry-docs-theme', value); } catch {} });
const menu = document.querySelector('.menu-button');
menu.addEventListener('click', () => { const open = document.querySelector('#sidebar').classList.toggle('open'); menu.setAttribute('aria-expanded', String(open)); });
document.addEventListener('keydown', event => { if(event.key==='Escape'){document.querySelector('#sidebar').classList.remove('open');menu.setAttribute('aria-expanded','false');} });
for (const block of document.querySelectorAll('pre')) {
  const button = document.createElement('button'); button.className = 'copy'; button.textContent = 'Copy'; button.setAttribute('aria-label', 'Copy code');
  button.addEventListener('click', async () => { try { await navigator.clipboard.writeText(block.querySelector('code').textContent); button.textContent='Copied'; } catch { button.textContent='Select code'; const range=document.createRange();range.selectNodeContents(block.querySelector('code'));const selection=getSelection();selection.removeAllRanges();selection.addRange(range); } setTimeout(()=>{button.textContent='Copy';},2000); });
  block.append(button);
}
const observer = new IntersectionObserver(entries => { for(const entry of entries) if(entry.isIntersecting){document.querySelectorAll('.toc>a').forEach(link=>link.classList.toggle('active',link.hash===`#${entry.target.id}`));} },{rootMargin:'-90px 0px -60% 0px'});
document.querySelectorAll('article h2[id]').forEach(heading=>observer.observe(heading));
