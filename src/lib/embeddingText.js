'use strict';

// What actually gets embedded for a given index.jsonl entry: the
// last_assistant_message already captured by archive.js, not the full
// transcript. It's already a bounded (<=1000 char), representative summary
// of the unit of work and is present for every entry regardless of
// retention pruning, so this avoids re-reading (and needing to still have
// on disk) the full archived transcript just to build the vector index.
// Shared by `claude-trail index` and prune.js's bounded auto-index pass.
function embeddingTextFor(entry) {
  const parts = [entry.agent_type, entry.last_assistant_message].filter(Boolean);
  return parts.join(': ').trim();
}

module.exports = { embeddingTextFor };
