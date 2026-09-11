---
name: deploy
description: Ship rayo-bandido — git add, commit, push to main, build, test, and deploy to AWS Elastic Beanstalk. Use this whenever Juan asks to "deploy", "push and deploy", "ship this", "release", "add commit push deploy", or asks to get changes live on rayobandido.com, even if he only says "deploy" with no other detail. Always use this instead of running ad hoc git/aws commands for a rayo-bandido deploy — this repo has two EB environments and only one of them is what rayobandido.com actually points to, and getting that wrong ships to the wrong place while looking like it worked.
---

# Deploying rayo-bandido

This repo's AWS account has **two** Elastic Beanstalk environments under the
`rayo-bandido` application in `sa-east-1`: one plain, one behind a load
balancer. `rayobandido.com` points at whichever one currently has the load
balancer or CNAME the domain resolves to — and that has already changed once
(see `docs/PROGRESS.md` deploy notes). Deploying to the other environment
looks successful (the AWS API says `Ready`, curling its own `.elasticbeanstalk.com`
URL shows the new build) while `rayobandido.com` keeps serving the old one —
that's a wasted deploy that reads as a finished one, which is worse than an
honest failure. So the one rule this skill exists to enforce: **never deploy
by name, always deploy to whatever the domain currently resolves to.**

The `eb` CLI is not installed on this machine. Everything below goes through
`aws` CLI v2 directly, which is exactly what `eb deploy` would do under the
hood anyway. The script needs no `jq` — it uses `aws --query` throughout, and
reads zip entry names with a few lines of Node, because that was one
dependency too many on a machine that turned out not to have it.

Credentials live in a named profile (`rayo-bandido`, long-term keys — the
account has no IAM Identity Center). The script picks it up automatically if
the default profile isn't configured, so `AWS_PROFILE` does not need setting
by hand.

## Run it

```bash
.Codex/skills/deploy/scripts/deploy.sh "commit message here"
```

The commit message is only needed if there are uncommitted changes — if the
tree is already clean and pushed, omit it and the script just builds, tests,
and deploys whatever is already on `main`. If there are uncommitted changes
and no message is given, it refuses to invent one, since inventing a message
for a production-shipping commit is more likely to paper over "I don't
actually know what changed" than to help.

The ordering principle throughout: **everything that can fail is made to fail
before the live environment is touched.** Nothing is committed, pushed or
uploaded until the exact bundle has been built, inspected and actually served
locally.

The script does, in order:

0. Preflight — checks `node`, `curl`, `aws`, working credentials, and an
   archiver that writes POSIX paths, all up front. These used to surface
   minutes in, after a full build and test run had already gone by.
1. `npm run build` then `npm test`, **before** any commit — a red suite must
   not leave a commit already pushed to `main`. It also fingerprints the
   working tree here, to catch someone editing in another window mid-run.
2. Resolves `rayobandido.com`'s Route53 A record to find what it actually
   points to (a load balancer or an environment's own CNAME), then matches
   that against every `Ready` environment under the `rayo-bandido`
   application to find the one true deploy target. The load-balancer lookup
   is retried, because `describe-environment-resources` intermittently
   returns a spurious "No Environment found" for an environment that
   `describe-environments` just listed as `Ready`. If it still can't find an
   unambiguous match, it stops and prints what it found instead of guessing.
3. Zips the bundle, respecting `.ebignore` (which is why `dist/` — gitignored,
   but required on the server — makes it in: `.ebignore`'s presence switches
   EB from "deploy what git tracks" to "deploy what's on disk"). A leading
   slash in `.ebignore` means root-only, and that is load-bearing: unanchored,
   `assets/` would also match `dist/assets/` and strip out the fingerprinted
   JS the whole game loads.
4. **Verifies the bundle** — refuses one carrying DOS path separators, or
   missing `dist/index.html`, `server/index.mjs`, `package.json`, `Procfile`,
   or the JS asset that `dist/index.html` actually references. Entry names
   are read raw from the zip's central directory in Node, because `bsdtar -tf`
   silently rewrites `dist\index.html` to `dist/index.html` as it lists, so a
   broken bundle looks perfectly healthy through the usual tools.
5. **Smoke-tests the bundle** — extracts the very archive about to be
   uploaded, boots its `server/index.mjs` on a spare port, and requires `/`,
   the referenced JS asset, and `/rooms` to all serve. Structural checks catch
   missing files; this catches a server that can't actually serve them.
6. Only now: `git add -A`, commit, `git push origin main` — and only if the
   working tree fingerprint still matches what was tested.
7. Uploads to the project's EB S3 bucket, registers an application version
   labeled `app-manual-<UTC timestamp>`, and calls `update-environment` on
   the resolved target.
8. Polls until `Ready`, then confirms the environment is actually running the
   version just sent — EB reports `Ready` for a deploy it aborted and rolled
   back, so "Ready" alone is not evidence of anything.
9. Curls `https://rayobandido.com/` and compares its served JS asset against
   the local `dist/index.html`. "Environment is Ready" and "the public domain
   is serving this build" are different claims; only the second is what was
   asked for. It also hits `/rooms` as a liveness check on the server process
   itself, not just the static assets. **If verification fails it rolls back**
   to the previous version label rather than leaving the domain broken.

## What to tell the user afterward

The script prints a `DEPLOY SUMMARY` block with the version label, the
resolved target environment, HTTP status, and the asset-hash comparison.
Relay that block (or its substance) rather than just saying "deployed" —
Juan has been burned before by a deploy that succeeded against the wrong
environment while looking fine, so the target environment name and the
live-vs-local hash match are the two lines that actually matter here.

If the script exits non-zero, do not tell the user the deploy is live. Read
the error — it's written to explain what it found (build failure, test
failure, ambiguous or unmatched DNS target, environment stuck, or a hash
mismatch after everything else succeeded) rather than just failing silently.

## Before deploying to `rayobandido.com`'s target

This is a real production deploy to a domain with real users. `git add`,
commit, and push are routine, but the AWS `update-environment` call is not —
proceed under whatever authorization the user's own request already carries
("deploy", "ship this", "push and deploy" all count), but if the resolved
target environment is a surprise (a name you haven't seen mentioned before,
or the DNS resolution came back ambiguous and you're tempted to just pick
one), stop and say what you found instead of pushing through it.

## If AWS setup changes

`REGION`, `APP_NAME`, and `DOMAIN` are the only hardcoded values, at the top
of `scripts/deploy.sh` — update them there if the app is renamed or moved
regions. The environment-matching logic itself stays dynamic on purpose;
don't add a hardcoded environment name anywhere, that's the exact mistake
this skill was written to stop happening again.
