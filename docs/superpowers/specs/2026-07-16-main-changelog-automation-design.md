# Main Changelog Automation Design

## Goal

Keep `CHANGELOG.md` current without manual edits after a supported pull request merges into `main`.
The file will follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions and will not create a release or Git tag for each merge.

## Changelog Format

`CHANGELOG.md` will contain an `Unreleased` section for changes that have reached `main` but have not been published as a package release.
Entries will appear under the standard headings `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, and `Security`.
The generator will create a heading only when it has an entry to add.

Each entry will contain the pull request title and a linked pull request number:

```markdown
### Added

- Bundle a version-matched agent skill ([#2](https://github.com/berrydev-ai/goodlinks-cli/pull/2))
```

Release versions and dates remain a separate release-time responsibility.

## Category Selection

The generator will choose one category for each merged pull request.
Labels take priority over title prefixes because they are explicit review metadata.

| Pull request signal | Changelog category |
| --- | --- |
| `security` label or `security:` title | `Security` |
| `removed` label or `remove:` title | `Removed` |
| `deprecated` label or `deprecate:` title | `Deprecated` |
| `bug` label or `fix:` title | `Fixed` |
| `enhancement` label or `feat:` title | `Added` |
| Any other pull request | `Changed` |

Matching will ignore case. Conventional Commit scopes such as `feat(cli):` and `fix(api):` will be recognized.

## Generator

Add a TypeScript command at `scripts/update-changelog.ts`.
It will read the GitHub `pull_request_target` event from `GITHUB_EVENT_PATH`, read `CHANGELOG.md`, and write the updated file.

The command will:

1. Reject malformed event data with a clear error.
2. Skip events that are not a merged pull request targeting `main`.
3. Skip a pull request whose linked number is already in the changelog.
4. Insert the entry beneath the matching heading in `Unreleased`, creating the heading when needed.
5. Write `changed=true` or `changed=false` to `GITHUB_OUTPUT` for the workflow.

The changelog transformation and event parsing will be exported as documented public functions.
Importing the script from a test will not execute the command.

## GitHub Workflow

Add `.github/workflows/main-changelog.yml` with a `pull_request_target` `closed` trigger.
The job will run only when the pull request was merged into `main`.
Because the trigger runs from the trusted base repository and checks out only `main`, it handles same-repository and ordinary fork pull requests without running pull-request head code.
GitHub may issue a read-only token for Dependabot-authored pull requests; those changelog updates require a different trusted credential or manual changelog follow-up.

The workflow will:

1. Check out the explicit trusted `main` ref with complete Git history, never pull-request head code.
2. Set up the repository's supported Node and pnpm versions.
3. Install dependencies from the lockfile.
4. Run `scripts/update-changelog.ts`.
5. Commit `CHANGELOG.md` only when the script reports a change.
6. Rebase on the latest `main` and push the changelog commit.

A repository-wide concurrency group with `queue: max` will queue every changelog update and process one at a time.
The workflow will have read access by default and grant only its job `contents: write` and `pull-requests: read`.

The workflow will not create or push Git tags.

## Tests

Tests will exercise the command's public behavior with temporary event and changelog files.
The critical cases are:

- A merged `feat(cli):` pull request is placed under `Added` in `Unreleased`.
- Explicit labels take priority over a conflicting title prefix.
- Missing headings are created in the standard category order.
- A repeated event does not duplicate its pull request entry.
- An unmerged or non-`main` pull request causes no file change.
- Malformed event data fails with a useful message.

The project test suite, typecheck, build, and skill checks must pass before completion.

## Operational Constraint

The repository must allow `github-actions[bot]` to push to `main`.
If branch rules prohibit that push, the workflow will fail after creating the local commit and the repository rules must explicitly allow this workflow or switch to a bot-created pull request.
