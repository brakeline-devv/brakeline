#!/bin/sh
# Publishes web/ to the gh-pages branch (GitHub Pages). The dashboard (app.*) is left out: it only works locally.
set -e
cd "$(dirname "$0")/.."
OUT=$(mktemp -d)
cp -r web/. "$OUT/" && rm -f "$OUT/app.html" "$OUT/app.js" && touch "$OUT/.nojekyll"
URL=$(git remote get-url origin)
cd "$OUT"
git init -q -b gh-pages
git -c user.name="Brakeline" -c user.email="dev@brakeline.invalid" add -A
git -c user.name="Brakeline" -c user.email="dev@brakeline.invalid" commit -q -m "Publish website"
git push -q -f "$URL" gh-pages
rm -rf "$OUT"
echo "Published mirror → https://brakeline-devv.github.io/brakeline/ (main site: https://brakeline.trade)"
