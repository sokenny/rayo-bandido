#!/usr/bin/env bash
# Put CloudFront in front of rayobandido.com. Safe to re-run: every step finds what an earlier
# run already made before creating anything.
#
#   infra/cloudfront/setup.sh              create the distribution and test it WITHOUT touching DNS
#   infra/cloudfront/setup.sh --cutover    same, then point rayobandido.com + www at it
#
# WHY IT IS SHAPED THIS WAY. Everything goes through one distribution with one origin (the EB
# load balancer), so the page, `/api`, `/rooms` and `/ws` stay on the same origin and the client
# needs no change. Only static files are cached: `/assets/*` is fingerprinted and the server
# already marks it immutable; the other media in `dist/` keep their names across builds, so they
# are cached for a day and `deploy.sh` invalidates `/*` after every release. Everything else is
# passed straight through, uncached, with every viewer header — including Host, which the origin
# needs both for its TLS certificate (it covers rayobandido.com, not the ALB's own name) and for
# the OAuth redirect URIs built in `server/api.mjs`.
#
# Rollback is the two DNS records: point them back at the ALB (printed at the end).
set -euo pipefail

DOMAIN="rayobandido.com"
REGION="sa-east-1"
CF_ZONE_ID="Z2FDTNDATAQYW2" # CloudFront's fixed hosted zone for alias records
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CUTOVER=""
[[ "${1:-}" == "--cutover" ]] && CUTOVER=1

log()  { echo "==> $*"; }
fail() { echo "ERROR: $*" >&2; exit 1; }

if ! aws sts get-caller-identity >/dev/null 2>&1; then
  export AWS_PROFILE="rayo-bandido"
  aws sts get-caller-identity >/dev/null 2>&1 || fail "No working AWS credentials."
fi

ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name "$DOMAIN" --max-items 1 \
  --query "HostedZones[?Name=='${DOMAIN}.'].Id | [0]" --output text)
ZONE_ID="${ZONE_ID#/hostedzone/}"
CURRENT=$(aws route53 list-resource-record-sets --hosted-zone-id "$ZONE_ID" \
  --query "ResourceRecordSets[?Name=='${DOMAIN}.' && Type=='A'] | [0].AliasTarget.DNSName" --output text)
CURRENT="${CURRENT%.}"
log "${DOMAIN} -> ${CURRENT}"

# --- 1. The certificate (CloudFront only reads ACM in us-east-1) -------------------------------
CERT_ARN=$(aws acm list-certificates --region us-east-1 --certificate-statuses ISSUED PENDING_VALIDATION \
  --query "CertificateSummaryList[?DomainName=='${DOMAIN}'].CertificateArn | [0]" --output text)
if [[ -z "$CERT_ARN" || "$CERT_ARN" == "None" ]]; then
  CERT_ARN=$(aws acm request-certificate --region us-east-1 --domain-name "$DOMAIN" \
    --subject-alternative-names "www.${DOMAIN}" --validation-method DNS --query CertificateArn --output text)
fi
log "Certificate ${CERT_ARN}; waiting for ISSUED (the validation CNAMEs are already in Route53)..."
aws acm wait certificate-validated --region us-east-1 --certificate-arn "$CERT_ARN"

# --- 2. The media cache policy -----------------------------------------------------------------
MEDIA_POLICY_ID=$(aws cloudfront list-cache-policies --type custom \
  --query "CachePolicyList.Items[?CachePolicy.CachePolicyConfig.Name=='rayo-bandido-media'].CachePolicy.Id | [0]" --output text)
if [[ -z "$MEDIA_POLICY_ID" || "$MEDIA_POLICY_ID" == "None" ]]; then
  MEDIA_POLICY_ID=$(aws cloudfront create-cache-policy \
    --cache-policy-config "file://${HERE}/cache-policy-media.json" --query 'CachePolicy.Id' --output text)
fi
log "Media cache policy ${MEDIA_POLICY_ID}"

# --- 3. The distribution -----------------------------------------------------------------------
DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Aliases.Items && contains(Aliases.Items, '${DOMAIN}')].Id | [0]" --output text)
if [[ -z "$DIST_ID" || "$DIST_ID" == "None" ]]; then
  if [[ "$CURRENT" == *.cloudfront.net ]]; then
    fail "${DOMAIN} already points at CloudFront but no distribution carries it as an alias."
  fi
  ALB_DNS="$CURRENT"
  [[ "$ALB_DNS" == *.elb.amazonaws.com ]] || fail "Expected ${DOMAIN} to point at the EB load balancer, got ${ALB_DNS}."
  CONFIG="$(mktemp)"
  node -e '
    const [src, out, cert, alb, media] = process.argv.slice(1);
    const cfg = JSON.parse(require("fs").readFileSync(src, "utf8"));
    cfg.ViewerCertificate.ACMCertificateArn = cert;
    cfg.Origins.Items[0].DomainName = alb;
    const { PathPattern: _, ...assets } = cfg.CacheBehaviors.Items[0];
    cfg.CacheBehaviors.Items = cfg.CacheBehaviors.Items.map((b) =>
      b.__MEDIA__ ? { ...assets, PathPattern: b.PathPattern, CachePolicyId: media } : b);
    require("fs").writeFileSync(out, JSON.stringify(cfg));
  ' "${HERE}/distribution.json" "$CONFIG" "$CERT_ARN" "$ALB_DNS" "$MEDIA_POLICY_ID"
  DIST_ID=$(aws cloudfront create-distribution --distribution-config "file://${CONFIG}" \
    --query 'Distribution.Id' --output text)
  rm -f "$CONFIG"
fi
CF_DNS=$(aws cloudfront get-distribution --id "$DIST_ID" --query 'Distribution.DomainName' --output text)
log "Distribution ${DIST_ID} (${CF_DNS}); waiting for Deployed..."
aws cloudfront wait distribution-deployed --id "$DIST_ID"

# --- 4. Test it through CloudFront before any user is sent there -------------------------------
EDGE_IP=$(dig +short "$CF_DNS" | grep -E '^[0-9.]+$' | head -1)
[[ -n "$EDGE_IP" ]] || fail "Could not resolve ${CF_DNS}."
via_cf() { curl -sS --resolve "${DOMAIN}:443:${EDGE_IP}" "$@"; }

log "Testing via edge ${EDGE_IP}..."
INDEX=$(via_cf -f "https://${DOMAIN}/") || fail "/ did not load through CloudFront."
ASSET=$(grep -o 'assets/index-[^"]*\.js' <<<"$INDEX" | head -1)
[[ -n "$ASSET" ]] || fail "/ through CloudFront carries no JS bundle."
via_cf -f -o /dev/null -H 'accept-encoding: br' "https://${DOMAIN}/${ASSET}" || fail "${ASSET} failed through CloudFront."
ASSET_CACHE=$(via_cf -s -o /dev/null -D - -H 'accept-encoding: br' "https://${DOMAIN}/${ASSET}" | tr -d '\r' | grep -i '^x-cache:' || true)
via_cf -f "https://${DOMAIN}/rooms" >/dev/null || fail "/rooms failed through CloudFront."
WS_STATUS=$(via_cf -o /dev/null -w '%{http_code}' --max-time 5 --http1.1 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' "https://${DOMAIN}/ws" || true)
[[ "$WS_STATUS" == "101" ]] || fail "/ws upgrade through CloudFront answered ${WS_STATUS}, expected 101."
log "OK: /, ${ASSET} (${ASSET_CACHE:-no x-cache}), /rooms, /ws upgrade 101."

# --- 5. Cut DNS over ---------------------------------------------------------------------------
if [[ -z "$CUTOVER" ]]; then
  log "Not touching DNS. Re-run with --cutover to send ${DOMAIN} through ${CF_DNS}."
  exit 0
fi
if [[ "$CURRENT" == "$CF_DNS" ]]; then
  log "${DOMAIN} already points at ${CF_DNS}."
  exit 0
fi

# Route53 stores the ALB name lowercased and ELBv2 reports it mixed-case, so match in the shell.
ALB_ZONE_ID=$(aws elbv2 describe-load-balancers --region "$REGION" \
  --query 'LoadBalancers[].[DNSName,CanonicalHostedZoneId]' --output text \
  | awk -v want="$CURRENT" 'tolower($1) == tolower(want) { print $2 }')
[[ -n "$ALB_ZONE_ID" ]] || fail "Could not find the load balancer ${CURRENT} to print a rollback for."

change() {
  local action="$1" target="$2" zone="$3" types=("${@:4}") items=()
  for name in "$DOMAIN" "www.${DOMAIN}"; do
    for type in "${types[@]}"; do
      items+=("{\"Action\":\"${action}\",\"ResourceRecordSet\":{\"Name\":\"${name}\",\"Type\":\"${type}\",\"AliasTarget\":{\"HostedZoneId\":\"${zone}\",\"DNSName\":\"${target}\",\"EvaluateTargetHealth\":false}}}")
    done
  done
  local IFS=,
  echo "{\"Changes\":[${items[*]}]}"
}

log "Pointing ${DOMAIN} and www at ${CF_DNS}..."
CHANGE_ID=$(aws route53 change-resource-record-sets --hosted-zone-id "$ZONE_ID" \
  --change-batch "$(change UPSERT "$CF_DNS" "$CF_ZONE_ID" A AAAA)" --query 'ChangeInfo.Id' --output text)
aws route53 wait resource-record-sets-changed --id "$CHANGE_ID"

echo
echo "Done. ${DOMAIN} -> ${CF_DNS} (${DIST_ID})."
echo "Rollback, in this order (A back to the ALB, then drop the AAAA records it never had):"
echo "  aws route53 change-resource-record-sets --hosted-zone-id ${ZONE_ID} --change-batch '$(change UPSERT "$CURRENT" "$ALB_ZONE_ID" A)'"
echo "  aws route53 change-resource-record-sets --hosted-zone-id ${ZONE_ID} --change-batch '$(change DELETE "$CF_DNS" "$CF_ZONE_ID" AAAA)'"
