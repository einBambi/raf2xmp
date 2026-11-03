#!/bin/sh
# SPDX-License-Identifier: MIT
# preflight.sh: run from the repository root before every push to a public remote.
# Exit code 0 means no finding. Exit code 1 means at least one FAIL line was printed.
# Needs git. Uses exiftool, gitleaks and trufflehog when they are installed.
#
# PREFLIGHT_PRIVATE_WORDS  words that must never appear in tracked text (your user name, family names, street), separated by spaces
# PREFLIGHT_STRICT=1       a missing scanner is a FAIL instead of a note (use this in CI, where nobody reads notes)
set -u

# the folder is called test/ in this repository, tests/ is accepted too
ALLOW_IMAGES='^tests?/(fixtures|golden)/SYNTH[A-Za-z0-9_.-]*$'
BIG_BYTES=1048576
fail=0
bad()  { printf 'FAIL: %s\n' "$*"; fail=1; }
note() { printf 'note: %s\n' "$*"; }
need() { if [ "${PREFLIGHT_STRICT:-0}" = 1 ]; then bad "$1 is not installed (strict mode)"; else note "$1 is not installed, step skipped"; fi; }

command -v git >/dev/null 2>&1 || { echo "git is missing"; exit 2; }
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "not inside a git work tree"; exit 2; }
cd "$(git rev-parse --show-toplevel)" || exit 2

echo "1. image, raw and sidecar files outside the synthetic allow list"
hits=$(git ls-files | grep -iE '\.(raf|dng|nef|nrw|cr2|cr3|arw|orf|rw2|pef|srw|3fr|iiq|jpe?g|jpe|png|tiff?|heic|heif|avif|webp|gif|bmp|xmp|psd|lrcat|lrdata)$' | grep -vE "$ALLOW_IMAGES")
[ -n "$hits" ] && bad "photo-like files tracked:
$hits"

echo "2. metadata inside allowed image files (serials, GPS, names)"
if command -v exiftool >/dev/null 2>&1; then
  allowed=$(git ls-files | grep -E "$ALLOW_IMAGES")
  if [ -n "$allowed" ]; then
    meta=$(printf '%s\n' "$allowed" | tr '\n' '\0' | xargs -0 exiftool -q -if '$GPSLatitude or $SerialNumber or $InternalSerialNumber or $BodySerialNumber or $LensSerialNumber or $OwnerName or $Artist or $Copyright or $ImageUniqueID or $Face1Name or $UserComment' -p '$Directory/$FileName')
    [ -n "$meta" ] && bad "allowed images still carry personal tags:
$meta"
  fi
else
  need exiftool
fi

echo "3. large tracked files (over 1 MiB)"
big=$(git ls-files | while IFS= read -r f; do
  [ -f "$f" ] && s=$(wc -c < "$f") && [ "$s" -gt "$BIG_BYTES" ] && printf '%s bytes  %s\n' "$s" "$f"
done)
[ -n "$big" ] && bad "large files tracked:
$big"

echo "4. paths, private words and original file names inside text files"
pat="/Users/|/home/[a-z]|C:[\\\\/]+Users|DSCF[0-9]{4}|[0-9]{3}_FUJI"
for w in ${PREFLIGHT_PRIVATE_WORDS:-}; do pat="$pat|$w"; done
[ -z "${PREFLIGHT_PRIVATE_WORDS:-}" ] && note "PREFLIGHT_PRIVATE_WORDS is empty, only generic path patterns are checked"
leak=$(git grep -nIiE "$pat" -- . ':(exclude)*preflight.sh' 2>/dev/null)
[ -n "$leak" ] && bad "possible private paths or names:
$leak"

echo "4b. pictures hidden inside text files (base64, data URIs, JPEG or PNG bytes), every tracked file"
b64=$(git grep -naE 'data:image/|base64[,:]|/9j/[A-Za-z0-9+/]{16}|iVBORw0KGgo' -- . ':(exclude)*preflight.sh' 2>/dev/null | cut -c1-160)
[ -n "$b64" ] && bad "embedded picture data in text:
$b64"
magic=$(for m in '\377\330\377' '\211PNG'; do LC_ALL=C git grep -alF -e "$(printf "$m")" -- . ':(exclude)*preflight.sh' 2>/dev/null; done | sort -u | grep -vE "$ALLOW_IMAGES")
[ -n "$magic" ] && bad "files containing JPEG or PNG bytes outside the allow list:
$magic"

echo "5. junk and credential-like file names"
junk=$(git ls-files | grep -E '(^|/)(\.DS_Store|Thumbs\.db|__pycache__|node_modules|\.idea|\.vscode|\.env[^/]*|id_(rsa|ed25519)[^/]*|[^/]*\.(pem|p12|pfx|key|log|bak|orig|swp|pyc))$')
[ -n "$junk" ] && bad "junk or credential-like files tracked:
$junk"

echo "6. commit identities in the whole history (author and committer separately)"
git log --all --format='author %an <%ae> | committer %cn <%ce>' 2>/dev/null | sort -u
authors=$(git log --all --format='%ae' 2>/dev/null | sort -u)
committers=$(git log --all --format='%ce' 2>/dev/null | sort -u)
printf '%s\n' "$authors" | grep -vE '@users\.noreply\.github\.com$' | grep -q . && bad "an author address is not a GitHub noreply address"
# commits made in the GitHub web interface or squash merges use noreply@github.com as committer, that one is fine
printf '%s\n' "$committers" | grep -vE '@users\.noreply\.github\.com$|^noreply@github\.com$' | grep -q . && bad "a committer address is not a GitHub noreply address"

echo "7. files that ever existed in any commit (deleted photos still sit in history)"
ever=$(git log --all --name-only --pretty=format: 2>/dev/null | sort -u | grep -iE '\.(raf|dng|nef|cr2|cr3|arw|jpe?g|png|tiff?|heic|webp|xmp|lrcat)$' | grep -vE "$ALLOW_IMAGES")
[ -n "$ever" ] && bad "photo-like paths exist in history (use a fresh history or git filter-repo):
$ever"
bigh=$(git rev-list --objects --all 2>/dev/null | git cat-file --batch-check='%(objecttype) %(objectsize) %(rest)' | awk -v lim="$BIG_BYTES" '$1=="blob" && $2>lim {print $2" bytes "$3}')
[ -n "$bigh" ] && bad "large blobs in history:
$bigh"

echo "8. refs that would be pushed along"
git branch -a 2>/dev/null | sed 's/^/  branch /'
git tag 2>/dev/null | sed 's/^/  tag /'
[ -n "$(git stash list 2>/dev/null)" ] && note "stash entries exist, they are not pushed, but check them before deleting the old repository"

echo "9. required top-level files"
for f in LICENSE README.md NOTICE.md SECURITY.md; do
  [ -f "$f" ] || bad "missing $f"
done

echo "10. secret scanners"
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks git . || bad "gitleaks reported findings"
else
  need gitleaks
fi
if command -v trufflehog >/dev/null 2>&1; then
  trufflehog git "file://$(pwd)" --no-verification || bad "trufflehog reported findings or failed"
else
  need trufflehog
fi

if [ "$fail" -eq 0 ]; then echo "preflight: no findings"; else echo "preflight: FAILED"; fi
exit "$fail"
