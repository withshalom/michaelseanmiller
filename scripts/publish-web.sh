#!/usr/bin/env bash
# Publishes the built site to the "web" branch.
#
#   npm run build
#   bash scripts/publish-web.sh
#
# What it does
#   - Copies everything in dist/ into the "web" branch (creating the branch the first time).
#   - Keeps that branch's history, so every publish is a commit you can roll back to.
#   - Does nothing if the site hasn't changed since the last publish.
#
# GitHub Actions runs this for you whenever you push to the michael branch.
#
# Optional settings (environment variables):
#   PUBLISH_BRANCH    branch to publish to          (default: web)
#   PUBLISH_TRAILER   extra lines for the commit message

set -euo pipefail

BRANCH="${PUBLISH_BRANCH:-web}"
DIST="${1:-dist}"

if [ ! -f "$DIST/index.html" ]; then
  echo "Nothing to publish: $DIST/index.html doesn't exist. Run 'npm run build' first." >&2
  exit 1
fi
DIST="$(cd "$DIST" && pwd)"

cd "$(git rev-parse --show-toplevel)"
SOURCE="$(git rev-parse --abbrev-ref HEAD)@$(git rev-parse --short HEAD)"

# Does the branch already exist on GitHub? (exit code 2 means "no such branch")
if git ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  EXISTS=1
else
  status=$?
  if [ "$status" -ne 2 ]; then
    echo "Couldn't reach GitHub to check for the '$BRANCH' branch." >&2
    exit 1
  fi
  EXISTS=0
fi

WORK="$(mktemp -d)"
cleanup() {
  git worktree remove --force "$WORK" >/dev/null 2>&1 || true
  rm -rf "$WORK"
  git worktree prune
}
trap cleanup EXIT

if [ "$EXISTS" = 1 ]; then
  # Start from what is already published, so its history is kept.
  git fetch --quiet --no-tags origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
  git worktree add --quiet --detach "$WORK" "origin/$BRANCH"
else
  # First publish: a brand-new branch that shares no history with the source code.
  git worktree add --quiet --detach "$WORK"
  git -C "$WORK" checkout --quiet --orphan "publish-$$"
  git -C "$WORK" rm -rfq --ignore-unmatch .
fi

# Replace the old site with the new one (everything except git's own bookkeeping).
find "$WORK" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -a "$DIST"/. "$WORK"/
touch "$WORK/.nojekyll" # tells GitHub Pages to serve the files exactly as they are
cat > "$WORK/README.md" <<'EOF'
# Built site — please don't edit here

This branch is generated. Every commit is the output of `npm run build` on the `michael` branch;
the commit message names the source commit.

To change the website, edit the `michael` branch and push. The site rebuilds and this branch updates by itself.
EOF

git -C "$WORK" add -A
if git -C "$WORK" diff --cached --quiet; then
  echo "The site hasn't changed since the last publish — nothing to do."
  exit 0
fi

NAME="$(git config user.name || true)"
EMAIL="$(git config user.email || true)"
MESSAGE="Publish site built from $SOURCE"
if [ -n "${PUBLISH_TRAILER:-}" ]; then
  MESSAGE="$MESSAGE"$'\n\n'"$PUBLISH_TRAILER"
fi

git -C "$WORK" \
  -c user.name="${NAME:-github-actions[bot]}" \
  -c user.email="${EMAIL:-41898282+github-actions[bot]@users.noreply.github.com}" \
  commit --quiet -m "$MESSAGE"
git -C "$WORK" push --quiet origin "HEAD:refs/heads/$BRANCH"
echo "Published to the '$BRANCH' branch ($SOURCE)."
