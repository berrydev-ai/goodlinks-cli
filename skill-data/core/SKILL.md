---
name: core
description: Safely inspect and operate a GoodLinks library with the installed goodlinks CLI, using live help for exact commands and explicit approval before every mutation.
---

# GoodLinks CLI operating guide

Use this version-matched guide before running `goodlinks`.

## Prerequisites

- Require GoodLinks 3.2 or newer with its local API enabled.
- Use `http://localhost:9428/api/v1` unless the user supplies another base URL.
- Place global `--base-url <url>` before the command.
- If `goodlinks` is unavailable, explain `pnpm add --global @berrydev-ai/goodlinks-cli` and wait for permission before installing.

## Protect credentials

- Never read or display a bearer token.
- Never inspect credential files, environment files, or environment-variable values.
- Let `goodlinks` resolve its configured credential source without exposing it.
- Never place credentials on the command line because shell history may retain them.
- Explain credential resolution after an authentication failure without asking to see a token.

## Load exact details

Read `references/commands.md` only when exact arguments, options, defaults, or choices are needed. Run leaf help before an unfamiliar command:

```sh
goodlinks <command> --help
```

If the reference and installed help disagree, follow installed help and report the drift.

## Core workflow

1. Start with a read-only command and prefer JSON when parsing output.
2. Use values found in the user's library; never invent IDs, tags, domains, URLs, or response data.
3. Inspect the target before a possible write.
4. Run `--dry-run` or report-only `--json` when supported.
5. Summarize the affected scope without unnecessarily exposing private article content.
6. Ask for explicit approval immediately before every mutation.
7. Execute only after unambiguous approval.
8. Read the changed state back and report the result.

Approval applies to one write or one clearly bounded batch. Do not reuse it for a later write.

### Approval hard stop

- The user's initial request is not approval to mutate, even when it asks to tag, edit, delete, clean up, or create files.
- Approval must arrive in a new user message after the preview and scope summary.
- After asking for approval, end your turn. Do not run the mutation in the same turn.
- If the session cannot receive a new user message, stop after the preview and report that the write was not run.
- If a guard or permission check blocks a command, do not retry, rephrase, or bypass it. Report the blocked attempt and stop.
- For a read-only task, do not create files, directories, or redirect output. Keep parsing in memory or use stdout-only pipes.
- Do not change read state, metadata, tags, highlights, or cached content during a read-only task.

## Command safety

### Read-only

- `links get`, `links get-url`, `links current`, `links list`, and `links search`;
- `links content --no-auto-download <link-id>`, which returns only content already cached by GoodLinks;
- `lists`, `tags`, `tags list`, `urls`, `highlights search`, and `highlights export`;
- `dedupe` or `dedupe --json` without `--delete`;
- `stale`, `report`, and `export` when writing only to stdout;
- `skills list`, `skills get`, and `skills path`.

`dead-links`, `auto-tag`, `untag`, `retag`, and `bulk-tag` are read-only only with `--dry-run` or report-only `--json`.

### GoodLinks mutations

Require immediate explicit approval before:

- `links add`, `links edit`, or `links delete`;
- `links content` without `--no-auto-download` because it may download and cache content;
- `highlights edit`;
- `tag-domain` without `--dry-run`;
- `dedupe --delete`;
- `dead-links`, `auto-tag`, `untag`, `retag`, or `bulk-tag` without dry-run or report-only mode.

Deletion moves links to GoodLinks trash but still requires approval. Before `dedupe --delete`, show the groups and explain that the oldest saved copy is retained.

### Filesystem mutations

Require the same approval before `visualize`, shell redirection into a report or export, or creating or overwriting a mapping, report, export, or visualization file.

## Common read workflows

```sh
goodlinks links search --search "<search-text>" --limit <count>
goodlinks stale --days <days> --json
goodlinks tags --json
goodlinks urls --json
goodlinks links get <link-id>
goodlinks highlights search --link-id <link-id>
```

## Preview and approval workflows

### Tag a discovered domain

1. Read `urls --json` and `tags --json`.
2. Use a domain and tag selected by the user or already present.
3. Run `goodlinks tag-domain --domain <domain> --tag <tag> --dry-run`.
4. Summarize the count, ask for approval, and end your turn.
5. Only after approval arrives in a new user message, remove `--dry-run` and execute.
6. Verify with `links search --tag <tag>`.

### Review duplicates

1. Run `goodlinks dedupe --json`.
2. Show the groups and oldest copies that would remain.
3. Ask for approval before `goodlinks dedupe --delete`, then end your turn.
4. Re-run `goodlinks dedupe --json` after deletion.

### Review dead links or bulk tags

For `dead-links`, `untag`, `retag`, `bulk-tag`, or `auto-tag`, first run the identical scope with `--json` or `--dry-run`. Show the planned count and changes, ask for approval, then apply and verify.

## Reports, exports, and visualization

Run `report` or `export` to stdout for inspection. If the user wants a file, state its exact destination and ask before redirecting output.

Before `visualize`, state the output directory and any Hugo paths. Ask for approval, then report the created paths.

## Recovery

- If the API is unavailable, ask the user to confirm GoodLinks is running and its local API is enabled, then verify the base URL.
- If validation fails, consult leaf `--help` and correct only the invalid argument or option.
- If a write fails, do not retry automatically. Re-run inspection because a looped bulk command may have partly succeeded.
- If bundled data is missing or invalid, recommend reinstalling the same npm version before upgrading or fetching remote content.
- If the repository reference is stale, run `pnpm run skill:generate` and review the diff.
