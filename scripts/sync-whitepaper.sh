#!/usr/bin/env bash
# Re-copy the whitepaper draft from the tulum-dao-whitepaper seat's build, check it, publish it
# UNLINKED + noindex at /whitepaper/, and verify by effect.
#   scripts/sync-whitepaper.sh <expected-pdf-sha256-prefix> "<commit message>"
# Refuses (nothing is copied or deployed) if the PDF hash differs from the one the seat
# announced, either file contains a private string, or the page lost its noindex meta.
set -euo pipefail
WANT=${1:?expected PDF sha256 prefix}
MSG=${2:?commit message}
SRC=${WHITEPAPER_SRC:-$HOME/scripts/agent-orchestra/.workspace/tulum-dao-whitepaper/web}
SITE_ID=ec85de9d-cf70-4172-b6d8-e7f16fba5f69
BASE=https://tulumdao-122.netlify.app/whitepaper
PDF=Tulum-DAO-The-Self-Tended-Fleet-DRAFT.pdf
cd "$(dirname "$0")/.."

got=$(sha256sum "$SRC/$PDF" | cut -c1-${#WANT})
[ "$got" = "$WANT" ] || { echo "REFUSED: PDF sha $got != announced $WANT"; exit 2; }

python3 - "$SRC" "$PDF" <<'EOF'
import re, sys, pypdf
src, pdf = sys.argv[1], sys.argv[2]
pat = r'tail[0-9a-f]{6}|ts\.net|srv1397016|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+|arkdata|\bshaw\b|@gmail|\.secrets|apr_[0-9a-f]|qnr_[0-9a-f]|msg_[0-9a-f]|internal review'
html = open(f'{src}/index.html').read()
r = pypdf.PdfReader(f'{src}/{pdf}')
text = '\n'.join(p.extract_text() or '' for p in r.pages)
bad = [m.group(0) for m in re.finditer(pat, html + text, re.I)]
if bad: sys.exit(f'REFUSED: private strings {sorted(set(bad))}')
if 'name="robots" content="noindex' not in html: sys.exit('REFUSED: index.html lost its noindex meta')
if re.search(r'<script[^>]+src=', html): sys.exit('REFUSED: external script in index.html')
print(f'checked: {len(r.pages)} pages, author {(r.metadata or {}).get("/Author")}, 0 private strings')
EOF

echo "text diff vs live copy (lines): $(diff <(sed 's/<[^>]*>//g' public/whitepaper/index.html) <(sed 's/<[^>]*>//g' "$SRC/index.html") | grep -c '^[<>]' || true)"
cp "$SRC/index.html" "$SRC/$PDF" public/whitepaper/
npm run build >/dev/null
git add public/whitepaper
git commit -qm "$MSG

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
git push -q
netlify deploy --prod --dir dist --site "$SITE_ID" --message "$(git rev-parse --short HEAD)" >/dev/null

echo "page: $(curl -s -o /dev/null -w %{http_code} "$BASE/") $(curl -sI "$BASE/" | grep -i x-robots | tr -d '\r')"
live=$(curl -s "$BASE/$PDF" | sha256sum | cut -c1-${#WANT})
echo "pdf: $(curl -s -o /dev/null -w %{http_code} "$BASE/$PDF") sha=$live $( [ "$live" = "$WANT" ] && echo MATCH || echo MISMATCH)"
echo "links from home: $(curl -s https://tulumdao-122.netlify.app/ | grep -c whitepaper || true)"
