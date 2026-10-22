#!/bin/bash
# Downloads the Khassaid meaning index (versets_cache.jsonl, ~280 MB) built by scripts/build-index.mjs.
# Too big for the main branch: it lives on the branch "index-data", cut in 40 MB pieces, with a checksum.
set -e
cd "$(dirname "$0")/../.."
BASE=${1:-https://raw.githubusercontent.com/inssatoure/lamp20/index-data}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -fsSL --retry 3 "$BASE/SHA256" -o "$TMP/SHA256"
for i in 00 01 02 03 04 05 06 07 08 09; do
  curl -fsSL --retry 3 "$BASE/versets_cache.jsonl.gz.part$i" -o "$TMP/part$i" 2>/dev/null || { rm -f "$TMP/part$i"; break; }
done
cat "$TMP"/part* > "$TMP/versets_cache.jsonl.gz"
(cd "$TMP" && sha256sum -c SHA256) || { echo "Téléchargement abîmé : réessaie."; exit 1; }
gunzip -c "$TMP/versets_cache.jsonl.gz" > versets_cache.jsonl.tmp && mv versets_cache.jsonl.tmp versets_cache.jsonl
echo "Index installé : $(wc -l < versets_cache.jsonl) distiques"
