#!/bin/bash
# Bulk import 122 Khassaid .txt files into Firestore via REST API
# This bypasses the gRPC permission issue

PROJECT_ID="lampridial-19466"
COLLECTION="knowledge_base"
API_URL="https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${COLLECTION}"
API_KEY="AIzaSyAWcGI0OZsHPh-IhglG_4MI9ZcQkkmUKw0"

DIR="$(dirname "$0")/../Textes_Arabes_Serigne_Touba"

IMPORTED=0
ERRORS=0
TOTAL=0

for file in "$DIR"/*.txt; do
  TOTAL=$((TOTAL + 1))
  filename=$(basename "$file" .txt)

  # Convert snake_case to Title Case
  title=$(echo "$filename" | sed 's/_/ /g' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) tolower(substr($i,2))}1')

  # Read content and escape for JSON
  content=$(cat "$file" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read().strip()))")

  sourceRef="Khassaid - ${title} - Cheikh Ahmadou Bamba"
  timestamp=$(date +%s)000

  # Build Firestore document JSON
  JSON=$(cat <<ENDJSON
{
  "fields": {
    "title": {"stringValue": "${title}"},
    "content": {"stringValue": ${content}},
    "arabicText": {"stringValue": ${content}},
    "category": {"stringValue": "Khassaid"},
    "sourceRef": {"stringValue": "${sourceRef}"},
    "language": {"stringValue": "ar"},
    "addedAt": {"integerValue": "${timestamp}"},
    "addedBy": {"stringValue": "bulk_import"}
  }
}
ENDJSON
)

  # POST to Firestore REST API
  RESPONSE=$(curl -s -w "%{http_code}" -o /tmp/firestore_resp.json \
    -X POST "${API_URL}?key=${API_KEY}" \
    -H "Content-Type: application/json" \
    -d "$JSON")

  if [ "$RESPONSE" = "200" ]; then
    echo "OK: ${title}"
    IMPORTED=$((IMPORTED + 1))
  else
    echo "ERROR (${RESPONSE}): ${title}"
    cat /tmp/firestore_resp.json 2>/dev/null | head -3
    ERRORS=$((ERRORS + 1))
  fi
done

echo ""
echo "=== IMPORT COMPLETE ==="
echo "Imported: ${IMPORTED}"
echo "Errors:   ${ERRORS}"
echo "Total:    ${TOTAL}"
