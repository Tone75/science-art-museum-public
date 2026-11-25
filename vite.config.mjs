import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// The map verifies its manifest and buffers in the browser. Include its declared image as well.
const publicAssets = [
  'favicon.svg',
  'live-art/tide-full.png',
  'live-art/twin-full.png',
  'live-art/petals-full.png',
  'parameter-map/manifest.json',
  'parameter-map/mandelbrot-field.u16',
  'parameter-map/mandelbrot-rgba.bin',
  'parameter-map/mandelbrot.png',
];

export default defineConfig(({ mode }) => {
  return {
    envDir: false,
    build: {
      outDir: mode === 'pages' ? 'dist-pages' : 'dist',
      emptyOutDir: true,
      copyPublicDir: false,
      sourcemap: false,
      modulePreload: { polyfill: false },
      rolldownOptions: { input: { museum: 'index.html' } },
    },
    plugins: [{
      name: 'museum-static-pages',
      buildStart() {
        // Pages can pick up Functions from the checkout even outside the upload directory.
        for (const path of ['functions', 'wrangler.toml', 'wrangler.json', 'wrangler.jsonc']) {
          if (existsSync(path)) this.error('Static Pages build found unexpected server configuration: ' + path);
        }
        for (const fileName of publicAssets) {
          this.emitFile({ type: 'asset', fileName, source: readFileSync('public/' + fileName) });
        }
        for (const fileName of ['404.html', '_headers']) {
          this.emitFile({ type: 'asset', fileName, source: readFileSync('pages/' + fileName) });
        }
      },
    }],
  };
});
