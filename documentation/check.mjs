import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist');
const files = (await readdir(root)).filter(f=>f.endsWith('.html'));
const documents = new Map(await Promise.all(files.map(async f=>[f,await readFile(path.join(root,f),'utf8')])));
const errors=[];
for(const [file,html] of documents){
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
 if(new Set(ids).size!==ids.length)errors.push(`${file}: duplicate IDs`);
 if(!html.includes('<title>')||!html.includes('lang="en"'))errors.push(`${file}: missing metadata`);
 for(const [,href] of html.matchAll(/(?:href|src)="([^"]+)"/g)){
  if(/^(https?:|mailto:|data:)/.test(href))continue;
  const [target,hash]=href.split('#');const destination=target||file;
  if(!documents.has(destination)){
   try{await stat(path.join(root,destination));}catch{errors.push(`${file}: missing ${href}`);}
  }else if(hash && !documents.get(destination).includes(`id="${hash}"`))errors.push(`${file}: missing anchor ${href}`);
 }
}
const pages=JSON.parse(await readFile(path.join(root,'search-index.json'),'utf8'));
for(const page of pages)if(!documents.has(page.url)||page.text.length<100)errors.push(`Invalid search entry ${page.url}`);
if(errors.length){console.error(errors.join('\n'));process.exit(1);}
console.log(`Checked ${files.length} HTML files: local links, assets, anchors, IDs, metadata, and ${pages.length} search entries passed.`);
