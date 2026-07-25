'use strict';

// Wraps the optional @huggingface/transformers dependency. Never required
// at the top of any always-run path (archive.js's SubagentStop hook,
// search.js's default lexical mode) — only lazily imported by the `index`
// command and `search --semantic`, both explicit opt-in operations. This
// keeps a plain `npm install`/SEA binary usable with zero model weights
// downloaded and no native addon loaded unless the user actually asks for
// semantic search.
//
// @huggingface/transformers pulls in onnxruntime-node (a native addon) and
// ships as ESM-only, so it's loaded via dynamic import() from this
// otherwise-CJS codebase — that's supported in Node regardless of the
// calling module's own type. It is also NOT bundleable into the SEA binary:
// esbuild can bundle JS but not the native .node runtime these packages
// ship per-platform, so semantic search is unavailable in SEA binary
// builds by design (see MISSING_DEP_HINT below for the message shown then).

const MISSING_DEP_HINT =
  'Semantic search requires the optional "@huggingface/transformers" package, which isn\'t installed.\n' +
  '  - If you installed claude-trail via npm: run `npm install @huggingface/transformers` ' +
  '(or reinstall claude-trail — it is an optionalDependency and npm may have skipped it on this platform).\n' +
  '  - If you\'re running a SEA binary release: semantic search isn\'t available in that build ' +
  '(no native module bundling) — install via npm/source instead, or use `--deep` for lexical search.';

let pipelinePromise = null;

async function loadEmbedder(modelName) {
  let transformers;
  try {
    transformers = await import('@huggingface/transformers');
  } catch (err) {
    const wrapped = new Error(MISSING_DEP_HINT);
    wrapped.cause = err;
    throw wrapped;
  }
  return transformers.pipeline('feature-extraction', modelName);
}

// One embedder instance per process, keyed by nothing — if the configured
// model changes mid-process (it won't, in practice: one CLI invocation
// reads config once) callers should just start a fresh process.
function getEmbedder(modelName) {
  if (!pipelinePromise) {
    pipelinePromise = loadEmbedder(modelName);
  }
  return pipelinePromise;
}

// Returns a plain array of floats (mean-pooled, L2-normalized) — asking
// transformers.js to do both so cosine similarity downstream reduces to a
// plain dot product.
async function embedText(modelName, text) {
  const embedder = await getEmbedder(modelName);
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

async function embedBatch(modelName, texts) {
  const embedder = await getEmbedder(modelName);
  const results = [];
  // Sequential, not Promise.all: transformers.js runs inference on a single
  // shared session, and batching one-at-a-time keeps memory bounded on
  // large backlogs (first-run indexing over months of archived entries)
  // rather than trying to hold every input tensor at once.
  for (const text of texts) {
    const output = await embedder(text, { pooling: 'mean', normalize: true });
    results.push(Array.from(output.data));
  }
  return results;
}

function cosineSimilarity(a, b) {
  // Both vectors are already L2-normalized by embedText/embedBatch, so the
  // dot product alone equals cosine similarity.
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) dot += a[i] * b[i];
  return dot;
}

module.exports = { embedText, embedBatch, cosineSimilarity, MISSING_DEP_HINT };
