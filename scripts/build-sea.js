#!/usr/bin/env node
'use strict';

// Builds a Node Single Executable Application (SEA) binary for the current
// platform/arch: bundle -> sea blob -> copy node -> postject inject ->
// (macOS only) ad-hoc codesign. Run once per OS/arch — CI invokes this once
// per matrix leg, since Node's own binary (the thing we copy and inject
// into) is only available for the platform/arch actually running.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');
const { inject } = require('postject');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BUNDLE_PATH = path.join(DIST, 'bundle.js');
const SEA_CONFIG_PATH = path.join(DIST, 'sea-config.json');
const BLOB_PATH = path.join(DIST, 'sea-prep.blob');

// Fixed by Node itself — not a secret, not configurable. Every SEA binary
// uses this exact string as the marker postject looks for.
const SEA_SENTINEL_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const PLATFORM_NAMES = { darwin: 'macos', linux: 'linux', win32: 'windows' };

function outputBinaryName() {
  const platform = PLATFORM_NAMES[process.platform] || process.platform;
  const ext = process.platform === 'win32' ? '.exe' : '';
  return `claude-trail-${platform}-${process.arch}${ext}`;
}

function bundle() {
  fs.mkdirSync(DIST, { recursive: true });
  esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'bin', 'claude-trail.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: BUNDLE_PATH,
    // @huggingface/transformers (semantic search, an optionalDependency) is
    // deliberately unavailable in SEA builds — it pulls in onnxruntime-node,
    // which ships prebuilt native .node binaries for every platform/arch;
    // esbuild has no loader for those and fails trying to bundle them.
    // Marking it external stops esbuild from tracing into it at all, so
    // `require`/`import()` of it is left as-is in the bundle — it simply
    // isn't installed in a SEA context, and embeddingModel.js's existing
    // try/catch around the dynamic import already surfaces a clear error
    // (MISSING_DEP_HINT) if `index`/`--semantic` are invoked from one.
    external: ['node:sea', '@huggingface/transformers'],
  });
}

// Absolute paths throughout — SEA config path resolution is relative to the
// process's cwd when `--experimental-sea-config` runs, not to the config
// file's own location, so relative paths here would be a footgun.
function writeSeaConfig() {
  const config = {
    main: BUNDLE_PATH,
    output: BLOB_PATH,
    disableExperimentalSEAWarning: true,
    // Neither the dashboard's index.html nor the claude-trail-search
    // SKILL.md can be read via fs.readFile(__dirname + ...) once bundled
    // into a single-file binary with no sibling files on disk — both are
    // embedded as named SEA assets and loaded via node:sea.getAsset()
    // instead (see dashboard.js and lib/skillInstaller.js).
    assets: {
      'index.html': path.join(ROOT, 'web', 'public', 'index.html'),
      'skill.md': path.join(ROOT, 'skills', 'claude-trail-search', 'SKILL.md'),
    },
  };
  fs.writeFileSync(SEA_CONFIG_PATH, JSON.stringify(config, null, 2));
}

function generateBlob() {
  execFileSync(process.execPath, ['--experimental-sea-config', SEA_CONFIG_PATH], { stdio: 'inherit' });
}

async function buildBinary() {
  const outPath = path.join(DIST, outputBinaryName());
  fs.copyFileSync(process.execPath, outPath);
  fs.chmodSync(outPath, 0o755);

  if (process.platform === 'darwin') {
    // Node binaries ship signed; postject can't modify a signed binary, so
    // the signature has to go first. Deliberately best-effort — a copied
    // node executable is always signed in practice, but don't hard-fail
    // the whole build over a codesign quirk on some runner image.
    try {
      execFileSync('codesign', ['--remove-signature', outPath], { stdio: 'inherit' });
    } catch (err) {
      console.warn(`codesign --remove-signature failed, continuing: ${err.message}`);
    }
  }

  await inject(outPath, 'NODE_SEA_BLOB', fs.readFileSync(BLOB_PATH), {
    sentinelFuse: SEA_SENTINEL_FUSE,
    machoSegmentName: process.platform === 'darwin' ? 'NODE_SEA' : undefined,
    overwrite: true,
  });

  if (process.platform === 'darwin') {
    // Ad-hoc signature (no Apple Developer certificate involved) — part of
    // the standard Node SEA recipe, not real code signing/notarization.
    // Without this the binary won't launch at all on most macOS setups
    // after postject strips the original signature. Real notarization
    // (removing the Gatekeeper "unidentified developer" warning) is a
    // separate, deliberately deferred concern — see README.
    execFileSync('codesign', ['--sign', '-', outPath], { stdio: 'inherit' });
  }

  return outPath;
}

async function main() {
  bundle();
  writeSeaConfig();
  generateBlob();
  const outPath = await buildBinary();
  console.log(`built: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
