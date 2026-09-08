#!/usr/bin/env bash
# Ship the working tree: commit, push, build, test, then deploy to whichever
# EB environment rayobandido.com currently resolves to. See ../SKILL.md for
# the reasoning; this file is the executable half.
#
# The ordering principle: everything that can fail is made to fail BEFORE the
# live environment is touched. A deploy that dies during preflight costs a
# minute; one that dies halfway through `update-environment` costs downtime on
# a domain with real users. Every check below exists because it (or its
# absence) has already cost one of those.
set -euo pipefail

REGION="sa-east-1"
APP_NAME="rayo-bandido"
DOMAIN="rayobandido.com"
FALLBACK_PROFILE="rayo-bandido"
SMOKE_PORT="${SMOKE_PORT:-8099}"

REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
cd "$REPO_ROOT"

log()  { echo "==> $*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

# Scratch space, always cleaned up. The smoke test extracts inside the repo so
# that Node can walk up and find node_modules (ESM ignores NODE_PATH, so a
# temp dir elsewhere cannot resolve `ws`).
SMOKE_DIR="${REPO_ROOT}/.deploy-smoke"
WORKDIR=""
SMOKE_PID=""
cleanup() {
  [[ -n "$SMOKE_PID" ]] && kill "$SMOKE_PID" 2>/dev/null || true
  [[ -n "$WORKDIR" && -d "$WORKDIR" ]] && rm -rf "$WORKDIR" || true
  [[ -d "$SMOKE_DIR" ]] && rm -rf "$SMOKE_DIR" || true
}
trap cleanup EXIT

COMMIT_MSG="${1:-}"

# =========================================================================
# 0. Preflight — prove the whole toolchain works before changing anything.
# =========================================================================
log "Preflight..."

command -v node >/dev/null 2>&1 || fail "node is not on PATH."
command -v curl >/dev/null 2>&1 || fail "curl is not on PATH."
command -v aws  >/dev/null 2>&1 || fail "aws CLI is not on PATH."

# --- Credentials ---------------------------------------------------------
# The account has no IAM Identity Center, so this is a long-term-key profile.
# An unset AWS_PROFILE used to surface as "NoCredentials" three minutes into a
# run, after a full build and test suite had already gone by.
if ! aws sts get-caller-identity >/dev/null 2>&1; then
  if AWS_PROFILE="$FALLBACK_PROFILE" aws sts get-caller-identity >/dev/null 2>&1; then
    export AWS_PROFILE="$FALLBACK_PROFILE"
  else
    fail "No working AWS credentials.
  Tried the default profile and '${FALLBACK_PROFILE}'.
  Fix with:  aws configure --profile ${FALLBACK_PROFILE}
  or point AWS_PROFILE at a profile that can reach account 569550444042."
  fi
fi
log "AWS identity: $(aws sts get-caller-identity --query Arn --output text)"

# --- An archiver that writes POSIX paths ---------------------------------
# This matters more than it looks. PowerShell's Compress-Archive writes DOS
# path separators into the zip; EB's Amazon Linux instance then extracts
# `dist\index.html` as one literal filename instead of a directory tree, and
# the deploy aborts with the uninformative "source bundle has issues". Only
# tools known to write forward slashes are accepted here.
ARCHIVER=""
ARCHIVER_KIND=""
if command -v zip >/dev/null 2>&1; then
  ARCHIVER="$(command -v zip)"; ARCHIVER_KIND="zip"
else
  # Windows ships bsdtar as System32\tar.exe, which writes correct zip entries.
  # Git-Bash's GNU tar cannot create zips at all, so check the flavor, not the name.
  for cand in "/c/Windows/System32/tar.exe" "$(command -v tar 2>/dev/null || true)"; do
    [[ -n "$cand" && -x "$cand" ]] || continue
    if "$cand" --version 2>&1 | grep -qi bsdtar; then
      ARCHIVER="$cand"; ARCHIVER_KIND="bsdtar"; break
    fi
  done
fi
[[ -n "$ARCHIVER" ]] || fail "No usable archiver found (need \`zip\`, or bsdtar as tar.exe).
  Install one with:  winget install --id GnuWin32.Zip
  Do NOT substitute PowerShell Compress-Archive — it writes DOS paths that EB cannot extract."
log "Archiver: ${ARCHIVER} (${ARCHIVER_KIND})"

# =========================================================================
# 1. Git: add, commit, push
# =========================================================================
if [[ -z "$(git status --porcelain)" ]]; then
  log "Working tree clean, nothing to commit."
else
  git add -A
  if [[ -z "$COMMIT_MSG" ]]; then
    fail "There are uncommitted changes but no commit message was given (pass it as the
  first argument). Refusing to invent one for a commit that ships to production."
  fi
  git commit -m "$COMMIT_MSG"
fi
log "Pushing to origin/main..."
git push origin main

# =========================================================================
# 2. Build and test, so a broken build never reaches production
# =========================================================================
log "Building..."
npm run build
log "Running tests..."
npm test

# =========================================================================
# 3. Resolve which EB environment rayobandido.com actually points to
# =========================================================================
# There is more than one EB environment in this account; the one Route53
# resolves the domain to is the only one that matters for "is it live".
# Hardcoding an environment name here would silently go stale the day someone
# repoints the domain, so this is looked up fresh every run.
log "Resolving which EB environment ${DOMAIN} points to..."

ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" --max-items 1 \
  --query "HostedZones[?Name=='${DOMAIN}.'].Id | [0]" --output text)
[[ -n "$ZONE_ID" && "$ZONE_ID" != "None" ]] || fail "No Route53 hosted zone found for ${DOMAIN}."
ZONE_ID="${ZONE_ID#/hostedzone/}"

# Alias records answer with AliasTarget.DNSName, plain ones with a record
# value; ask for both and take whichever is there.
TARGET_DNS=$(aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" \
  --query "ResourceRecordSets[?Name=='${DOMAIN}.' && Type=='A'] | [0].AliasTarget.DNSName" --output text)
if [[ -z "$TARGET_DNS" || "$TARGET_DNS" == "None" ]]; then
  TARGET_DNS=$(aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" \
    --query "ResourceRecordSets[?Name=='${DOMAIN}.' && Type=='A'] | [0].ResourceRecords[0].Value" --output text)
fi
[[ -n "$TARGET_DNS" && "$TARGET_DNS" != "None" ]] || \
  fail "${DOMAIN}'s A record has neither an alias target nor a plain value — can't resolve it."
TARGET_DNS="${TARGET_DNS%.}"
log "${DOMAIN} -> ${TARGET_DNS}"

lower() { tr '[:upper:]' '[:lower:]'; }

ENV_NAMES=$(aws elasticbeanstalk describe-environments --application-name "$APP_NAME" \
  --region "$REGION" --query "Environments[?Status=='Ready'].EnvironmentName" --output text)
[[ -n "$ENV_NAMES" ]] || fail "No Ready environments under application '${APP_NAME}'."

TARGET_ENV=""
for name in $ENV_NAMES; do
  CNAME=$(aws elasticbeanstalk describe-environments --environment-names "$name" \
    --region "$REGION" --query 'Environments[0].CNAME' --output text)
  if [[ "$(echo "$CNAME" | lower)" == "$(echo "$TARGET_DNS" | lower)" ]]; then
    TARGET_ENV="$name"; break
  fi
done

if [[ -z "$TARGET_ENV" ]]; then
  # Not a single-instance environment's own CNAME — so the domain points at a
  # load balancer fronting one of them. describe-environment-resources is
  # intermittently flaky here (it has returned a spurious "No Environment
  # found" for an environment that describe-environments had just listed as
  # Ready), so each lookup is retried rather than treated as a real answer.
  for name in $ENV_NAMES; do
    LBS=""
    for attempt in 1 2 3; do
      if LBS=$(aws elasticbeanstalk describe-environment-resources --environment-name "$name" \
                 --region "$REGION" --query 'EnvironmentResources.LoadBalancers[].Name' \
                 --output text 2>/dev/null) && [[ -n "$LBS" ]]; then
        break
      fi
      sleep 3
    done
    for lb in $LBS; do
      [[ -z "$lb" || "$lb" == "None" ]] && continue
      if [[ "$lb" == arn:* ]]; then
        LB_DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns "$lb" --region "$REGION" \
          --query 'LoadBalancers[0].DNSName' --output text 2>/dev/null || echo "")
      else
        LB_DNS=$(aws elb describe-load-balancers --load-balancer-names "$lb" --region "$REGION" \
          --query 'LoadBalancerDescriptions[0].DNSName' --output text 2>/dev/null || echo "")
      fi
      [[ -z "$LB_DNS" || "$LB_DNS" == "None" ]] && continue
      if [[ "$(echo "$LB_DNS" | lower)" == "$(echo "$TARGET_DNS" | lower)" ]]; then
        TARGET_ENV="$name"; break 2
      fi
    done
  done
fi

if [[ -z "$TARGET_ENV" ]]; then
  echo "Could not match ${DOMAIN} (-> ${TARGET_DNS}) to any Ready EB environment under" >&2
  echo "application '${APP_NAME}'. Known Ready environments:" >&2
  for name in $ENV_NAMES; do
    echo "  - ${name}  ($(aws elasticbeanstalk describe-environments --environment-names "$name" \
      --region "$REGION" --query 'Environments[0].CNAME' --output text))" >&2
  done
  fail "Not guessing which one to deploy to — resolve this by hand first."
fi
log "${DOMAIN} is served by EB environment: ${TARGET_ENV}"

# =========================================================================
# 4. Build the deploy bundle, honoring .ebignore
# =========================================================================
# .ebignore's presence switches EB from "deploy what git tracks" to "deploy
# what's on disk" — that's the only way dist/ (gitignored, but required on the
# server) travels at all.
#
# Patterns are read from .ebignore rather than hardcoded so edits there keep
# working. A leading slash means "root only", which is load-bearing: a bare
# `index.html` would also match `dist/index.html` and leave the server with
# assets but no entry document, and a bare `assets/` would take `dist/assets/`
# — the fingerprinted JS the whole game loads from — with it.
STAMP=$(date -u +%y%m%d_%H%M%S)
VERSION="app-manual-${STAMP}"
WORKDIR=$(mktemp -d)
ZIP="${WORKDIR}/${VERSION}.zip"

# Session and tooling artifacts .ebignore doesn't mention because they aren't
# app config. .deploy-smoke is this script's own scratch dir.
SKIP_ROOT=(".claude" ".elasticbeanstalk" ".git" ".deploy-smoke")
NESTED_EXCLUDES=()

if [[ -f .ebignore ]]; then
  while IFS= read -r pattern || [[ -n "$pattern" ]]; do
    pattern="${pattern%$'\r'}"
    [[ -z "$pattern" || "$pattern" == \#* ]] && continue
    if [[ "$pattern" == /* ]]; then
      # Root-anchored: drop it from the top-level list and never hand it to
      # the archiver, so nothing at depth is caught by the same name.
      SKIP_ROOT+=("$(basename "${pattern%/}")")
    elif [[ "$pattern" == */ ]]; then
      # Unanchored directory: skip at root and exclude at any depth.
      SKIP_ROOT+=("${pattern%/}")
      NESTED_EXCLUDES+=("${pattern}*")
    else
      NESTED_EXCLUDES+=("$pattern")
    fi
  done < .ebignore
fi

skipped() {
  local needle="$1"
  for s in "${SKIP_ROOT[@]}"; do [[ "$s" == "$needle" ]] && return 0; done
  return 1
}

INCLUDES=()
while IFS= read -r entry; do
  entry="${entry#./}"
  [[ -z "$entry" ]] && continue
  skipped "$entry" || INCLUDES+=("$entry")
done < <(find . -mindepth 1 -maxdepth 1 -printf '%P\n' 2>/dev/null || ls -A)

[[ ${#INCLUDES[@]} -gt 0 ]] || fail "Nothing left to ship after applying .ebignore."

log "Zipping deploy bundle as ${VERSION}..."
if [[ "$ARCHIVER_KIND" == "zip" ]]; then
  ZIP_EXCLUDES=()
  for p in "${NESTED_EXCLUDES[@]}"; do ZIP_EXCLUDES+=(-x "$p"); done
  "$ARCHIVER" -r -q "$ZIP" "${INCLUDES[@]}" "${ZIP_EXCLUDES[@]}"
else
  TAR_EXCLUDES=()
  for p in "${NESTED_EXCLUDES[@]}"; do TAR_EXCLUDES+=(--exclude="$p"); done
  "$ARCHIVER" -a -cf "$ZIP" "${TAR_EXCLUDES[@]}" "${INCLUDES[@]}"
fi

# =========================================================================
# 5. Verify the bundle's shape before anything leaves this machine
# =========================================================================
# Both of the failure modes checked here have actually shipped: a Windows-made
# zip with DOS separators (deploy aborted, environment went Red) and a bundle
# missing dist/index.html (deploy "succeeded", domain served 404 at the root).
log "Verifying bundle contents..."

list_archive() {
  if [[ "$ARCHIVER_KIND" == "zip" ]]; then unzip -Z1 "$1"; else "$ARCHIVER" -tf "$1"; fi
}
NAMES=$(list_archive "$ZIP")

if grep -q '\\' <<<"$NAMES"; then
  fail "Bundle contains DOS path separators — EB's Linux instance cannot extract this.
  The archiver wrote Windows paths; do not build the bundle with Compress-Archive."
fi

for required in dist/index.html server/index.mjs package.json Procfile; do
  grep -qx "$required" <<<"$NAMES" || fail "Bundle is missing ${required}."
done

# The entry document is only useful if the JS it points at is in the bundle too.
LOCAL_ASSET=$(grep -o 'assets/index-[^"]*\.js' dist/index.html | head -1)
[[ -n "$LOCAL_ASSET" ]] || fail "dist/index.html references no JS bundle — is the build broken?"
grep -qx "dist/${LOCAL_ASSET}" <<<"$NAMES" || \
  fail "Bundle is missing dist/${LOCAL_ASSET}, which dist/index.html loads."

log "Bundle OK ($(list_archive "$ZIP" | wc -l) entries, $(du -h "$ZIP" | cut -f1))."

# =========================================================================
# 6. Smoke-test the exact bundle locally, before production sees it
# =========================================================================
# Boot the real server out of an extracted copy of the very archive about to
# be uploaded and ask it for what production must answer. This is the step
# that keeps a broken bundle from ever reaching a live environment — the
# structural checks above catch missing files, this catches a server that
# cannot actually serve them.
log "Smoke-testing the bundle on port ${SMOKE_PORT}..."
rm -rf "$SMOKE_DIR"; mkdir -p "$SMOKE_DIR"
if [[ "$ARCHIVER_KIND" == "zip" ]]; then
  unzip -qq "$ZIP" -d "$SMOKE_DIR"
else
  "$ARCHIVER" -xf "$ZIP" -C "$SMOKE_DIR"
fi

# The instance installs its own production dependencies; locally the server
# resolves `ws` by walking up out of .deploy-smoke into the repo's node_modules.
PORT="$SMOKE_PORT" node "$SMOKE_DIR/server/index.mjs" >"$WORKDIR/smoke.log" 2>&1 &
SMOKE_PID=$!

SMOKE_OK=""
for _ in $(seq 1 20); do
  if curl -fsS -o /dev/null "http://127.0.0.1:${SMOKE_PORT}/" 2>/dev/null; then SMOKE_OK=1; break; fi
  kill -0 "$SMOKE_PID" 2>/dev/null || break
  sleep 1
done
if [[ -z "$SMOKE_OK" ]]; then
  echo "--- server output ---" >&2; cat "$WORKDIR/smoke.log" >&2
  fail "The bundle's own server could not serve / locally. Not shipping it."
fi

SMOKE_ASSET=$(curl -fsS "http://127.0.0.1:${SMOKE_PORT}/" | grep -o 'assets/index-[^"]*\.js' | head -1)
[[ "$SMOKE_ASSET" == "$LOCAL_ASSET" ]] || \
  fail "Local server served asset '${SMOKE_ASSET}', expected '${LOCAL_ASSET}'."
curl -fsS -o /dev/null "http://127.0.0.1:${SMOKE_PORT}/${LOCAL_ASSET}" || \
  fail "Local server could not serve ${LOCAL_ASSET}."
curl -fsS -o /dev/null "http://127.0.0.1:${SMOKE_PORT}/rooms" || \
  fail "Local server could not answer /rooms."

kill "$SMOKE_PID" 2>/dev/null || true
SMOKE_PID=""
rm -rf "$SMOKE_DIR"
log "Smoke test passed: /, ${LOCAL_ASSET} and /rooms all served from the bundle."

# =========================================================================
# 7. Upload and register the application version
# =========================================================================
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="elasticbeanstalk-${REGION}-${ACCOUNT_ID}"
KEY="${APP_NAME}/${VERSION}.zip"

log "Uploading to s3://${BUCKET}/${KEY}..."
aws s3 cp "$ZIP" "s3://${BUCKET}/${KEY}" --region "$REGION" --only-show-errors

log "Registering application version ${VERSION}..."
aws elasticbeanstalk create-application-version \
  --application-name "$APP_NAME" \
  --version-label "$VERSION" \
  --source-bundle "S3Bucket=${BUCKET},S3Key=${KEY}" \
  --region "$REGION" >/dev/null

# =========================================================================
# 8. Deploy, remembering what to fall back to
# =========================================================================
PREV_VERSION=$(aws elasticbeanstalk describe-environments --environment-names "$TARGET_ENV" \
  --region "$REGION" --query 'Environments[0].VersionLabel' --output text)
log "Currently deployed version: ${PREV_VERSION}"

wait_ready() {
  local env="$1" status="" line=""
  for _ in $(seq 1 40); do
    line=$(aws elasticbeanstalk describe-environments --environment-names "$env" \
      --region "$REGION" --query 'Environments[0].[Status,Health,VersionLabel]' --output text)
    echo "    $(date -u +%H:%M:%S) ${line}"
    status=$(awk '{print $1}' <<<"$line")
    [[ "$status" == "Ready" ]] && return 0
    sleep 15
  done
  return 1
}

log "Deploying ${VERSION} to ${TARGET_ENV} (this serves real traffic)..."
aws elasticbeanstalk update-environment \
  --environment-name "$TARGET_ENV" --version-label "$VERSION" --region "$REGION" >/dev/null

wait_ready "$TARGET_ENV" || fail "Timed out waiting for ${TARGET_ENV} to reach Ready — check the
  EB console before telling anyone this deployed."

# EB reports Ready even for a deploy it aborted and rolled back, so confirm the
# environment is actually running the version that was just sent.
LIVE_VERSION=$(aws elasticbeanstalk describe-environments --environment-names "$TARGET_ENV" \
  --region "$REGION" --query 'Environments[0].VersionLabel' --output text)
if [[ "$LIVE_VERSION" != "$VERSION" ]]; then
  echo "ERROR: ${TARGET_ENV} is Ready but running '${LIVE_VERSION}', not '${VERSION}'." >&2
  echo "The deploy was aborted by EB. Recent events:" >&2
  aws elasticbeanstalk describe-events --environment-name "$TARGET_ENV" --region "$REGION" \
    --max-items 10 --query 'Events[].[Severity,Message]' --output text >&2
  exit 1
fi

# =========================================================================
# 9. Verify the live domain, and roll back if it is not actually serving
# =========================================================================
# "Ready" only means the environment applied the version; it says nothing
# about whether rayobandido.com's DNS/CDN path actually serves it.
log "Verifying https://${DOMAIN}/ serves the new build..."

check_live() {
  LIVE_ASSET=$(curl -fsS "https://${DOMAIN}/" 2>/dev/null | grep -o 'assets/index-[^"]*\.js' | head -1 || true)
  HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' "https://${DOMAIN}/")
  ROOMS=$(curl -fsS "https://${DOMAIN}/rooms" 2>/dev/null || echo "(request failed)")
  [[ "$HTTP_CODE" == "200" && -n "$LOCAL_ASSET" && "$LOCAL_ASSET" == "$LIVE_ASSET" ]]
}

# A load balancer can need a moment to route to the refreshed instance.
VERIFIED=""
for _ in 1 2 3 4 5; do
  if check_live; then VERIFIED=1; break; fi
  sleep 5
done

if [[ -z "$VERIFIED" ]]; then
  echo >&2
  echo "VERIFICATION FAILED — ${DOMAIN} is not serving ${VERSION}." >&2
  echo "  HTTP ${HTTP_CODE}, live asset '${LIVE_ASSET}', expected '${LOCAL_ASSET}'." >&2
  if [[ -n "$PREV_VERSION" && "$PREV_VERSION" != "None" && "$PREV_VERSION" != "$VERSION" ]]; then
    echo "Rolling back to ${PREV_VERSION} so the domain is not left broken..." >&2
    aws elasticbeanstalk update-environment --environment-name "$TARGET_ENV" \
      --version-label "$PREV_VERSION" --region "$REGION" >/dev/null
    wait_ready "$TARGET_ENV" || true
    if check_live; then
      echo "Rolled back. ${DOMAIN} is serving ${PREV_VERSION} again." >&2
    else
      echo "ROLLBACK ALSO FAILED — ${DOMAIN} needs manual attention now." >&2
    fi
  fi
  exit 1
fi

echo
echo "==================== DEPLOY SUMMARY ===================="
echo "Version label:      ${VERSION}"
echo "Target environment: ${TARGET_ENV}"
echo "Previous version:   ${PREV_VERSION}"
echo "HTTP status:        ${HTTP_CODE}"
echo "Local build asset:  ${LOCAL_ASSET}"
echo "Live domain asset:  ${LIVE_ASSET}"
echo "/rooms response:    ${ROOMS}"
echo "Result:             MATCH — ${DOMAIN} is serving this deploy."
echo "==========================================================="
