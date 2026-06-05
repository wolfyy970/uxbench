const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const watch = process.argv.includes("--watch");

const commonConfig = {
    bundle: true,
    minify: true,
    sourcemap: true,
    logLevel: "info",
};

async function build() {
    // Ensure dist exists
    if (!fs.existsSync("dist")) {
        fs.mkdirSync("dist");
    }

    // Copy manifest
    fs.copyFileSync("manifest.json", "dist/manifest.json");

    // Copy sidepanel HTML
    fs.copyFileSync("src/sidepanel/index.html", "dist/sidepanel.html");

    // Build Background Worker
    await esbuild.build({
        ...commonConfig,
        entryPoints: ["src/background/worker.ts"],
        outfile: "dist/service-worker.js",
        platform: "browser",
        target: "es2020",
    });

    // Build Content Script
    await esbuild.build({
        ...commonConfig,
        entryPoints: ["src/content/collector.ts"],
        outfile: "dist/content-script.js",
        platform: "browser",
        target: "es2020",
    });

    // Build Side Panel App
    await esbuild.build({
        ...commonConfig,
        entryPoints: ["src/sidepanel/app.ts"],
        outfile: "dist/sidepanel.js",
        platform: "browser",
        target: "es2020",
    });

    // Build embeddable library (ESM)
    await esbuild.build({
        ...commonConfig,
        entryPoints: ["src/library/index.ts"],
        outfile: "dist/uxbench.esm.js",
        platform: "browser",
        target: "es2020",
        format: "esm",
    });

    // Build embeddable library (direct script tag)
    await esbuild.build({
        ...commonConfig,
        entryPoints: ["src/library/index.ts"],
        outfile: "dist/uxbench.iife.js",
        platform: "browser",
        target: "es2020",
        format: "iife",
        globalName: "UxBench",
    });

    console.log("Build complete");
}

build().catch(() => process.exit(1));
