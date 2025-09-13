// Ensure CommonJS semantics inside dist-cjs even though the root package is ESM
// This avoids "exports is not defined" when requiring the CJS build.

import fs from 'fs';
import path from 'path';

const outDir = path.resolve(process.cwd(), 'dist-cjs');
fs.mkdirSync(outDir, { recursive: true });
const pkg = { type: 'commonjs' };
fs.writeFileSync(path.join(outDir, 'package.json'), JSON.stringify(pkg, null, 2));
console.log('Wrote dist-cjs/package.json with { "type": "commonjs" }');
