// Inlines the stylesheet and the two ES modules into one self-contained
// dist/index.html, for sharing as a single file or a preview link.
// No dependencies: run with `node scripts/bundle.mjs`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const css = read('src/styles.css');
const data = read('src/data.js');
const app = read('src/app.js').replace(/^import .*?from '\.\/data\.js';\n/m, '');
// data.js uses `export`; strip the keyword so both files share one scope.
const js = `${data.replace(/^export /gm, '')}\n${app}`;

let html = read('index.html')
  .replace('<link rel="stylesheet" href="src/styles.css">', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="src/app.js"></script>', `<script type="module">\n${js}\n</script>`);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/index.html'), html);
console.log(`dist/index.html written (${(html.length / 1024).toFixed(1)} KB)`);
