import { cp, mkdir, writeFile } from 'node:fs/promises';
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
await writeFile(path.join(root, 'dist', '.nojekyll'), '');
console.log(configured ? 'Built GitHub Pages site with Supabase.' : 'Built demo interface; Supabase is not configured.');
