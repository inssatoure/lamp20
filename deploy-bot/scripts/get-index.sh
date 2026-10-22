#!/bin/bash
# Downloads the Khassaid meaning index (versets_cache.jsonl, ~280 MB) built by scripts/build-index.mjs.
# It is too big for git, so it is published as a GitHub release file.
cd "$(dirname "$0")/../.." || exit 1
URL=${1:-https://github.com/inssatoure/lamp20/releases/download/index-latest/versets_cache.jsonl.gz}
curl -fL --retry 3 "$URL" -o versets_cache.jsonl.gz && gunzip -f versets_cache.jsonl.gz && ls -la versets_cache.jsonl
