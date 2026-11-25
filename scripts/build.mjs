import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import manifest from '../package.json' with { type: 'json' };

const root = fileURLToPath(new URL('../', import.meta.url));
await Promise.all([
  build({
    absWorkingDir: root,
    entryPoints: ['index.js'],
    outfile: 'dist/index.js',
    bundle: true,
    platform: 'node',
    external: ['#openmodel-models'],
    target: 'node22.19',
    format: 'esm',
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  }),
  build({
    absWorkingDir: root,
    entryPoints: ['client.js'],
    outfile: 'dist/client.js',
    bundle: true,
    platform: 'browser',
    target: 'es2022',
    format: 'cjs',
    jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'],
    loader: { '.css': 'text', '.svg': 'dataurl' },
    banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(manifest.name)}, factory: (require) => { const module = { exports: {} }; const exports = module.exports;` },
    footer: { js: 'return module.exports; } });' },
  }),
]);
