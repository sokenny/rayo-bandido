#!/usr/bin/env bash
# Ship the working tree: commit, push, build, test, then deploy to whichever
# EB environment rayobandido.com currently resolves to. See ../SKILL.md for
# the reasoning; this file is the executable half.
set -euo pipefail

REGION="sa-east-1"
APP_NAME="rayo-bandido"
DOMAIN="rayobandido.com"

REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
cd "$REPO_ROOT"

log() { echo "==> $*"; }

COMMIT_MSG="${1:-}"

# --- 1. Git: add, commit, push -------------------------------------------
if [[ -z "$(git status --porcelain)" ]]; then
  log "Working tree clean, nothing to commit."
else
  git add -A
  if [[ -z "$COMMIT_MSG" ]]; then
    echo "There are uncommitted changes but no commit message was given (pass it as the" >&2
    echo "first argument). Refusing to invent one for a commit that ships to production." >&2
    exit 1
  fi
  git commit -m "$(printf '%s\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>' "$COMMIT_MSG")"
fi
log "Pushing to origin/main..."
git push origin main

# --- 2. Build and test, so a broken build never reaches production -------
log "Building..."
npm run build
log "Running tests..."
npm test

# --- 3. Resolve which EB environment rayobandido.com actually points to --
# There is more than one EB environment in this account; the one Route53
# resolves the domain to is the only one that matters for "is it live".
# Hardcoding an environment name here would silently go stale the day
# someone repoints the domain, so this is looked up fresh every run.
log "Resolving which EB environment ${DOMAIN} points to..."

ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" --max-items 1 \
  --query "HostedZones[?Name=='${DOMAIN}.'].Id | [0]" --output text)
if [[ -z "$ZONE_ID" || "$ZONE_ID" == "None" ]]; then
  echo "No Route53 hosted zone found for ${DOMAIN}." >&2
  exit 1
fi
ZONE_ID="${ZONE_ID#/hostedzone/}"

APEX_A=$(aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" \
  --query "ResourceRecordSets[?Name=='${DOMAIN}.' && Type=='A'] | [0]" --output json)
TARGET_DNS=$(echo "$APEX_A" | jq -r '.AliasTarget.DNSName // empty' | sed 's/\.$//')
if [[ -z "$TARGET_DNS" ]]; then
  TARGET_DNS=$(echo "$APEX_A" | jq -r '.ResourceRecords[0].Value // empty' | sed 's/\.$//')
fi
if [[ -z "$TARGET_DNS" ]]; then
  echo "${DOMAIN}'s A record has neither an alias target nor a plain value — can't resolve it." >&2
  exit 1
fi
log "${DOMAIN} -> ${TARGET_DNS}"

ENVS=$(aws elasticbeanstalk describe-environments --application-name "$APP_NAME" \
  --region "$REGION" --query "Environments[?Status=='Ready'].{Name:EnvironmentName,CNAME:CNAME}" --output json)

TARGET_ENV=$(echo "$ENVS" | jq -r --arg t "$TARGET_DNS" \
  '.[] | select((.CNAME // "" | ascii_downcase) == ($t | ascii_downcase)) | .Name' | head -1)

if [[ -z "$TARGET_ENV" ]]; then
  # Not a single-instance environment's own CNAME — check whether it's a
  # load balancer fronting one of the environments instead. EB hands back
  # the LB as a full ARN (ALB/NLB) or a bare name (classic ELB) depending on
  # environment vintage, so try both lookup styles.
  for name in $(echo "$ENVS" | jq -r '.[].Name'); do
    LBS=$(aws elasticbeanstalk describe-environment-resources --environment-name "$name" \
      --region "$REGION" --query 'EnvironmentResources.LoadBalancers[].Name' --output text 2>/dev/null || true)
    for lb in $LBS; do
      [[ -z "$lb" ]] && continue
      if [[ "$lb" == arn:* ]]; then
        LB_DNS=$(aws elbv2 describe-load-balancers --load-balancer-arns "$lb" --region "$REGION" \
          --query 'LoadBalancers[0].DNSName' --output text 2>/dev/null || echo "")
      else
        LB_DNS=$(aws elb describe-load-balancers --load-balancer-names "$lb" --region "$REGION" \
          --query 'LoadBalancerDescriptions[0].DNSName' --output text 2>/dev/null || echo "")
      fi
      if [[ -n "$LB_DNS" && "$LB_DNS" != "None" ]]; then
        if [[ "$(echo "$LB_DNS" | tr '[:upper:]' '[:lower:]')" == "$(echo "$TARGET_DNS" | tr '[:upper:]' '[:lower:]')" ]]; then
          TARGET_ENV="$name"
        fi
      fi
    done
  done
fi

if [[ -z "$TARGET_ENV" ]]; then
  echo "Could not match ${DOMAIN} (-> ${TARGET_DNS}) to any Ready EB environment under" >&2
  echo "application '${APP_NAME}'. Known environments:" >&2
  echo "$ENVS" | jq -r '.[] | "  - \(.Name)  (\(.CNAME))"' >&2
  echo "Not guessing which one to deploy to — resolve this by hand first." >&2
  exit 1
fi
log "${DOMAIN} is served by EB environment: ${TARGET_ENV}"

# --- 4. Build the deploy bundle, honoring .ebignore -----------------------
# .ebignore's presence switches EB from "deploy what git tracks" to "deploy
# what's on disk" — that's the only way dist/ (gitignored, but required on
# the server) travels at all. Translate its gitignore-style lines into zip
# -x patterns rather than hardcoding them, so edits to .ebignore keep working.
STAMP=$(date -u +%y%m%d_%H%M%S)
VERSION="app-manual-${STAMP}"
WORKDIR=$(mktemp -d)
ZIP="${WORKDIR}/${VERSION}.zip"

EXCLUDES=(-x '.claude/*' -x '.claude' -x '.elasticbeanstalk/*' -x '.git/*')
if [[ -f .ebignore ]]; then
  while IFS= read -r pattern; do
    [[ -z "$pattern" || "$pattern" == \#* ]] && continue
    if [[ "$pattern" == */ ]]; then
      EXCLUDES+=(-x "${pattern}*")
    elif [[ "$pattern" == /* ]]; then
      EXCLUDES+=(-x ".${pattern}")
    else
      EXCLUDES+=(-x "$pattern")
    fi
  done < .ebignore
fi

log "Zipping deploy bundle as ${VERSION}..."
zip -r -q "$ZIP" . "${EXCLUDES[@]}"

# --- 5. Upload and register the application version -----------------------
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="elasticbeanstalk-${REGION}-${ACCOUNT_ID}"
KEY="${APP_NAME}/${VERSION}.zip"

log "Uploading to s3://${BUCKET}/${KEY}..."
aws s3 cp "$ZIP" "s3://${BUCKET}/${KEY}" --region "$REGION" --only-show-errors
rm -rf "$WORKDIR"

log "Registering application version ${VERSION}..."
aws elasticbeanstalk create-application-version \
  --application-name "$APP_NAME" \
  --version-label "$VERSION" \
  --source-bundle "S3Bucket=${BUCKET},S3Key=${KEY}" \
  --region "$REGION" >/dev/null

# --- 6. Deploy to the resolved environment and wait ------------------------
log "Deploying ${VERSION} to ${TARGET_ENV} (this serves real traffic)..."
aws elasticbeanstalk update-environment \
  --environment-name "$TARGET_ENV" \
  --version-label "$VERSION" \
  --region "$REGION" >/dev/null

STATUS=""
for _ in $(seq 1 40); do
  LINE=$(aws elasticbeanstalk describe-environments --environment-names "$TARGET_ENV" \
    --region "$REGION" --query 'Environments[0].[Status,Health,VersionLabel]' --output text)
  echo "    $(date -u +%H:%M:%S) ${LINE}"
  STATUS=$(echo "$LINE" | awk '{print $1}')
  [[ "$STATUS" == "Ready" ]] && break
  sleep 15
done
if [[ "$STATUS" != "Ready" ]]; then
  echo "Timed out waiting for ${TARGET_ENV} to reach Ready — check the EB console before" >&2
  echo "telling anyone this deployed." >&2
  exit 1
fi

# --- 7. Verify the live domain, not just the environment status -----------
# "Ready" only means the environment applied the version; it says nothing
# about whether rayobandido.com's DNS/CDN path actually serves it.
log "Verifying https://${DOMAIN}/ serves the new build..."
LOCAL_HASH=$(grep -o 'assets/index-[^"]*\.js' dist/index.html | head -1 || true)
LIVE_HASH=$(curl -fsS "https://${DOMAIN}/" | grep -o 'assets/index-[^"]*\.js' | head -1 || true)
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' "https://${DOMAIN}/")
ROOMS=$(curl -fsS "https://${DOMAIN}/rooms" 2>/dev/null || echo "(request failed)")

echo
echo "==================== DEPLOY SUMMARY ===================="
echo "Version label:      ${VERSION}"
echo "Target environment: ${TARGET_ENV}"
echo "HTTP status:         ${HTTP_CODE}"
echo "Local build asset:   ${LOCAL_HASH}"
echo "Live domain asset:   ${LIVE_HASH}"
echo "/rooms response:     ${ROOMS}"
if [[ "$HTTP_CODE" == "200" && -n "$LOCAL_HASH" && "$LOCAL_HASH" == "$LIVE_HASH" ]]; then
  echo "Result:               MATCH — ${DOMAIN} is serving this deploy."
else
  echo "Result:               MISMATCH — do not report this as live, investigate first."
  exit 1
fi
echo "==========================================================="
