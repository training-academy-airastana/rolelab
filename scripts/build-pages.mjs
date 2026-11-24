import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateSupabaseConfig } from '../public/supabase-api.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = await import('../public/config.mjs');
const url = process.env.SUPABASE_URL || config.SUPABASE_URL;
const key = process.env.SUPABASE_PUBLISHABLE_KEY || config.SUPABASE_PUBLISHABLE_KEY;
const configured = validateSupabaseConfig(url, key);
if (process.argv.includes('--require-supabase') && !configured) throw new Error('Configure SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY before publishing.');
await mkdir(path.join(root, 'dist'), { recursive: true });
await cp(path.join(root, 'public'), path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, 'dist', 'config.mjs'), `export const SUPABASE_URL = ${JSON.stringify(url)};\nexport const SUPABASE_PUBLISHABLE_KEY = ${JSON.stringify(key)};\n`);
const dist = path.join(root, 'dist');
async function listAssets(folder, prefix = '') {
  const files=[];
  for(const item of await readdir(folder,{withFileTypes:true})) {
    const name=prefix+item.name;
    if(item.isDirectory())files.push(...await listAssets(path.join(folder,item.name),name+'/'));
    else if(/\.(?:js|mjs|css)$/.test(name))files.push(name);
  }
  return files.sort();
}
const assets = await listAssets(dist);
const hash = createHash('sha256');
for (const asset of assets) hash.update(asset).update(await readFile(path.join(dist, asset)));
const version = hash.digest('hex').slice(0,12);
let html = await readFile(path.join(root, 'dist', 'index.html'), 'utf8');
for (const asset of assets) html = html.replaceAll(`./${asset}`, `./${asset}?v=${version}`);
await writeFile(path.join(root, 'dist', 'index.html'), html);
for(const asset of assets.filter(name=>/\.(?:js|mjs)$/.test(name))) {
  const file=path.join(dist,asset);
  const source=await readFile(file,'utf8');
  await writeFile(file,source.replace(/\b(from\s+|import\s*\(\s*|import\s+)(['"])(\.[^'"]+\.(?:js|mjs))\2/g,(_,prefix,quote,url)=>`${prefix}${quote}${url}?v=${version}${quote}`));
}
await writeFile(path.join(root, 'dist', '.nojekyll'), '');
console.log(configured ? 'Built GitHub Pages site with Supabase.' : 'Built demo interface; Supabase is not configured.');
