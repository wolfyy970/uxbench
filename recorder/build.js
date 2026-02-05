const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const watch = process.argv.includes('--watch');

const commonConfig = {
    bundle: true,
    minify: true,
    sourcemap: true,
    logLevel: 'info',
};

async function build() {
    // Ensure dist exists
    if (!fs.existsSync('dist')) {
        fs.mkdirSync('dist');
    }

    // Copy manifest
    fs.copyFileSync('manifest.json', 'dist/manifest.json');

    // Copy sidepanel HTML
    fs.copyFileSync('src/sidepanel/index.html', 'dist/sidepanel.html');

    // Build Background Worker
    await esbuild.build({
        ...commonConfig,
        entryPoints: ['src/background/worker.ts'],
        outfile: 'dist/service-worker.js',
        platform: 'browser',
        target: 'es2020',
    });

    // Build Content Script
    await esbuild.build({
        ...commonConfig,
        entryPoints: ['src/content/collector.ts'],
        outfile: 'dist/content-script.js',
        platform: 'browser',
        target: 'es2020',
    });

    // Build Side Panel App
    await esbuild.build({
        ...commonConfig,
        entryPoints: ['src/sidepanel/app.ts'],
        outfile: 'dist/sidepanel.js',
        platform: 'browser',
        target: 'es2020',
    });

    console.log('Build complete');
}

build().catch(() => process.exit(1));
