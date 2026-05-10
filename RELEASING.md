# Branching & Releases

How code gets from your laptop to npm.

## TL;DR

```bash
# day-to-day
git checkout -b feat/short-description
# ...edit, commit...
git push -u origin feat/short-description
# open PR → review → merge to main

# release (when main is in a good state)
git checkout main && git pull
npm version <patch|minor|major> -m "chore: release v%s"
git push --follow-tags
# CI publishes to npm with provenance via Trusted Publishing
```

## Branching strategy

Trunk-based. One long-lived branch (`main`), short-lived feature branches off it.

| Branch | Purpose | Lifetime |
|---|---|---|
| `main` | Always releasable. Every commit on `main` should pass CI. | Permanent |
| `feat/*` | New features | Until merged |
| `fix/*` | Bug fixes | Until merged |
| `chore/*` | Tooling, deps, infra | Until merged |
| `docs/*` | README / RELEASING / CONTRIBUTING edits | Until merged |
| `release/*` | Prep work for a non-trivial release (rare; usually unneeded) | Until tagged |

Rules:

- Branch from `main`, merge back to `main`.
- One concern per branch. Split unrelated changes into separate PRs.
- Squash-merge or rebase-merge into `main`. No merge commits — keeps history linear.
- Delete the branch after merge.

## Commit messages

Conventional Commits. Keep them short. The prefix matters more than prose.

```
feat: handle Vue config embedded jest blocks
fix: drop ./ prefix from bin path
docs: clarify --strict semantics in README
chore: bump @babel/parser to 7.29.5
ci: switch release workflow to OIDC trusted publishing
test: add fixture for ts-jest preset with custom transform
refactor: extract moduleNameMapper handling into helper
```

The prefix becomes the changelog signal in the next release.

## Versioning (semver)

| Bump | When |
|---|---|
| **patch** (`0.1.0 → 0.1.1`) | Bug fix, doc tweak, internal refactor. No behavior change for callers. |
| **minor** (`0.1.0 → 0.2.0`) | New feature, new mapped Jest field, new CLI flag. Backwards compatible. |
| **major** (`0.1.0 → 1.0.0`) | Breaking change to the API or CLI: removed export, renamed option, output shape changed. |

Pre-1.0, minor bumps may include breaking changes if necessary, but call them out loudly in the changelog.

## Standard release flow

After PRs land on `main`:

```bash
git checkout main && git pull
npm test                    # double-check locally
npm version patch -m "chore: release v%s"
# This bumps package.json + package-lock.json, commits, and creates a v0.1.1 tag.

git push --follow-tags
```

What happens next, automatically:

1. The `v*` tag push triggers `.github/workflows/release.yml`
2. CI runs `npm ci`, `npm test`, `npm run build`
3. CI runs `npm publish --access public` via **Trusted Publishing** (OIDC)
4. npm registers the publish with a **provenance attestation** linking the npm tarball to the exact GitHub commit + workflow run
5. New version is live at `https://www.npmjs.com/package/@shiftkit/jest-to-vitest`

Watch the run: <https://github.com/JustShift/jest-to-vitest/actions>.

## Updating the changelog

Before tagging, edit `CHANGELOG.md`:

```md
## 0.1.1 — 2026-MM-DD

- fix: drop ./ prefix from bin path so npm publish stops warning
- docs: add RELEASING.md
```

Group entries by type (feat / fix / docs / chore) when there are several.

## Hotfix flow

If a bug in the latest release is blocking users:

```bash
git checkout main && git pull
git checkout -b fix/short-description
# ...fix and add a regression test...
git commit -am "fix: <description>"
git push -u origin fix/short-description
# open PR, merge to main

git checkout main && git pull
npm version patch -m "chore: release v%s"
git push --follow-tags
```

If `main` has unreleasable in-progress work, branch the hotfix off the most recent release tag instead:

```bash
git checkout -b fix/urgent v0.1.1
# ...fix...
npm version patch -m "chore: release v%s"      # creates v0.1.2
git push --follow-tags
# then cherry-pick or merge the fix back into main
```

## Pre-release / canary versions

For testing in-progress changes without affecting `latest` users:

```bash
npm version prerelease --preid=canary -m "chore: release v%s"
# 0.2.0 → 0.2.1-canary.0

git push --follow-tags
```

The release workflow needs a small change to handle this — the publish step should add a dist-tag for non-stable versions:

```bash
# in release.yml, replace the publish step with:
- run: |
    if [[ "${GITHUB_REF_NAME}" == *"-canary"* ]]; then
      npm publish --access public --tag canary
    else
      npm publish --access public
    fi
```

Users install pre-releases with `npm install @shiftkit/jest-to-vitest@canary`.

## Rolling back

npm severely restricts unpublishing. If a release is broken:

1. **First 72 hours, no dependents:** `npm unpublish @shiftkit/jest-to-vitest@<version>` — last resort, fragments the version timeline
2. **Otherwise — deprecate, don't unpublish:**
   ```bash
   npm deprecate @shiftkit/jest-to-vitest@0.1.1 "Has a critical bug, use 0.1.2 instead"
   ```
   Then ship a `0.1.2` patch with the fix.

Deprecation prints a warning on install but doesn't break existing lockfiles. This is the right tool 99% of the time.

## What CI runs

| Workflow | Trigger | What it does |
|---|---|---|
| `ci.yml` | Push or PR to any branch | Lint (`tsc --noEmit`) + tests on Node 18, 20, 22 + build |
| `release.yml` | Push of a `v*` tag | Tests + build + `npm publish` via OIDC |

If `ci.yml` fails on a PR, do not merge. If `release.yml` fails, the tag is created but no publish happened — investigate the run, push a fix, then bump and re-tag (e.g. `v0.1.2` after a failed `v0.1.1`).

## First-time setup checklist (for new maintainers)

- [ ] Clone the repo
- [ ] `npm install`
- [ ] `npm test` — all green
- [ ] Read `CONTRIBUTING.md`
- [ ] Read this file
- [ ] If a publisher: ensure your GitHub account is in the `JustShift` org with write access. Trusted Publishing handles npm auth — you don't need an npm token.
