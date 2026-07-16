# GoodLinks CLI Agent Skill Design

**Date:** 2026-07-16

**Status:** Approved

## Goal

Bundle a portable agent skill with `@berrydev-ai/goodlinks-cli` so skill-compatible agents can discover the CLI, load instructions that match the installed npm version, and operate GoodLinks safely.

The supporting research is in [`docs/research/cli-agent-skill-patterns.md`](../../research/cli-agent-skill-patterns.md).

## User decisions

- Use a thin public bootstrap plus a version-matched runtime skill.
- Require a read-only inspection or dry-run before a write whenever the CLI supports one.
- Require explicit user approval immediately before every GoodLinks or filesystem mutation.
- Keep every source, generated artifact, test, and distribution file in this repository.

## Success criteria

1. A cross-agent skill installer can discover `goodlinks-cli` from this repository.
2. The installed bootstrap directs an agent to `goodlinks skills get core`.
3. The runtime skill and command reference ship in the same npm package as the CLI.
4. Exact command details come from the installed CLI's Commander model and `--help` output, not model memory.
5. The skill starts with read-only inspection, stops for explicit approval before every write, and never prints or reads credentials.
6. Tests prove source-tree behavior, generated-reference freshness, and packed-package behavior.
7. Fresh Codex and Claude sessions can complete a read-only task and stop at the approval boundary for write and delete tasks.

## Non-goals

- Do not build an MCP server.
- Do not add a `goodlinks skills install` command or maintain agent-specific install paths.
- Do not commit separate skill copies under `.agents`, `.claude`, `.github`, or other host directories.
- Do not fetch skill content from a remote service at runtime.
- Do not add Claude-only frontmatter or require Codex-only metadata for correct behavior.
- Do not change existing GoodLinks API command behavior except for the related version-parity fix.

## Architecture

Use two skill trees with separate responsibilities:

```text
skills/
  goodlinks-cli/
    SKILL.md
    agents/
      openai.yaml
skill-data/
  core/
    SKILL.md
    references/
      commands.md
```

`skills/goodlinks-cli/SKILL.md` is the portable discovery entry point. It contains only standard `name` and `description` frontmatter plus short bootstrap instructions. It tells an agent to load the detailed guide by running `goodlinks skills get core`.

`skill-data/core/SKILL.md` is the version-matched operating guide. It is read from the installed npm package, so its workflows and safety rules travel with the corresponding binary. The generated command reference is loaded only when exact flags, defaults, arguments, or choices are needed.

This is like a label on a box pointing to the manual packed inside the same box. The label can be installed into many agent hosts, while the detailed manual remains tied to the installed CLI version.

## File responsibilities

### Skill files

- `skills/goodlinks-cli/SKILL.md`: portable trigger description and runtime-load command. It must not duplicate the detailed guide.
- `skills/goodlinks-cli/agents/openai.yaml`: optional Codex presentation metadata generated from the bootstrap. Other agents may ignore it.
- `skill-data/core/SKILL.md`: authentication rules, core workflow, read and write safety, common task recipes, and troubleshooting.
- `skill-data/core/references/commands.md`: generated command tree with arguments, options, defaults, choices, and descriptions.

### CLI files

- `src/program.ts`: export a documented `createProgram(version: string): Command` function. It builds the complete Commander tree but does not parse arguments, contact GoodLinks, or resolve credentials.
- `src/cli.ts`: read the package version, create the program, parse arguments, and preserve the existing top-level error handling.
- `src/package-metadata.ts`: read and validate the version from the repository or installed package's `package.json` relative to the current module.
- `src/skills.ts`: resolve the packaged `skill-data` root, parse skill frontmatter, list skills, read one skill, collect supported reference files, and return stable errors.
- `src/commands/skills.ts`: register `goodlinks skills list|get|path` and adapt registry results to stdout.

### Maintenance files

- `scripts/generate-skill-reference.ts`: traverse `createProgram()` and either write or check `references/commands.md`.
- `scripts/smoke-packed-skills.ts`: pack the built package into a temporary directory, run its skill commands, assert required files and output, then clean up.
- `tests/help.test.ts`: continue testing command discovery and cover the extracted program factory.
- `tests/skills.test.ts`: test skill listing, loading, full loading, path resolution, unknown names, and missing files through real CLI processes.
- `tests/skill-reference.test.ts`: prove generated content matches the committed reference.
- `package.json`: ship both skill trees and add generation, checking, and packed-package smoke scripts.
- `README.md`: document agent-skill installation, direct runtime loading, and validation commands.

## Public bootstrap

The bootstrap name is `goodlinks-cli`. Its description must include the tasks that should trigger it: reading, searching, adding, editing, tagging, cleaning, reporting, exporting, and visualizing a GoodLinks library through the `goodlinks` CLI.

The body stays small:

1. Ensure `goodlinks` is available; if it is not, tell the user how to install `@berrydev-ai/goodlinks-cli` and wait for permission rather than installing silently.
2. Run `goodlinks skills get core` before operating the CLI.
3. Run `goodlinks skills list` if the requested runtime guide cannot be found.

The bootstrap must not contain the full command catalog, credential values, agent-specific tool permissions, or duplicated recipes.

## Runtime skill content

The runtime `core` skill uses progressive disclosure and imperative instructions. It contains:

- prerequisites for GoodLinks 3.2 or newer with its local API enabled;
- token-resolution behavior without reading or displaying token values;
- the rule that global `--base-url` appears before the command;
- a read-first workflow using JSON output where available;
- exact classification of read-only, GoodLinks-mutating, and filesystem-mutating commands;
- the explicit approval boundary before every mutation;
- common recipes for search, stale links, tag statistics, domain tagging, duplicate review, dead-link review, reports, exports, and visualization;
- recovery behavior after authentication, connection, validation, partial-write, and package-integrity errors;
- a direction to consult `references/commands.md` and installed `--help` for exact command details.

Recipes must use values discovered from the user's library or explicit placeholders such as `<link-id>`. They must not invent IDs, tags, domains, credentials, response payloads, or other mock data.

## CLI skill commands

### `goodlinks skills list`

List every bundled runtime skill in stable name order. Print one tab-separated line per skill:

```text
<name>\t<description>
```

Version one ships only `core`, but discovery must be directory-based so another runtime skill can be added without changing the command adapter.

### `goodlinks skills get <name>`

Print the named skill's `SKILL.md` unchanged to stdout. Do not add ANSI styling, status text, or logging to stdout.

### `goodlinks skills get <name> --full`

Print `SKILL.md`, followed by each supported text resource in stable lexical path order. Introduce each extra resource with this Markdown-safe marker:

```text
<!-- skill-resource: references/commands.md -->
```

Version one includes Markdown files under `references/`. Binary assets and executable scripts are not required.

### `goodlinks skills path [name]`

With no name, print the absolute packaged `skill-data` directory. With a name, print that skill's absolute directory. This is diagnostic output and must not inspect the directory contents beyond normal registry validation.

### Errors

- An unknown name exits nonzero with `Unknown bundled skill: <name>. Available: <names>`.
- A missing or unreadable `skill-data` root exits nonzero and identifies the npm installation as incomplete.
- Invalid frontmatter exits nonzero and identifies the affected relative file without printing its contents.
- Skill commands never construct a GoodLinks client, resolve a token, or access the network.

## Command-reference generation

The generator imports `createProgram()` and recursively walks Commander commands, arguments, and options. It emits deterministic Markdown containing:

- usage and description;
- positional arguments;
- local and inherited global options;
- default values;
- accepted choices;
- child commands.

Generation must not invoke a GoodLinks API, read credentials, depend on terminal width, or scrape the README. Sort only where Commander order is not a meaningful part of the public interface.

Provide two modes:

- write mode updates `skill-data/core/references/commands.md`;
- check mode generates in memory, compares exact text, and exits nonzero with the regeneration command when different.

The installed CLI's leaf `--help` remains the final authority. If live help and the generated file disagree, the runtime skill tells the agent to follow live help and report the drift.

## Safety model

### Credential handling

- Never print, read, request, or embed the bearer token.
- Never inspect credential files or environment files.
- Let the CLI resolve its configured credential file or process environment without exposing values.
- Avoid recommending `--token` because command-line values can enter shell history.

### Read-before-write workflow

For every mutation:

1. Inspect the target with a read-only command.
2. Run `--dry-run` or report-only `--json` when that command supports it.
3. Show the affected scope in plain language without exposing private article content unnecessarily.
4. Ask for explicit approval immediately before the write command.
5. Execute only after an unambiguous approval.
6. Read the changed state back and report the result.

Approval does not carry from one write to another unless the user explicitly approves a clearly bounded batch.

### Mutating commands

Treat these as GoodLinks mutations:

- `links add`, `links edit`, and `links delete`;
- `highlights edit`;
- `tag-domain` without `--dry-run`;
- `dedupe --delete`;
- `dead-links`, `auto-tag`, `untag`, `retag`, and `bulk-tag` without their dry-run or report-only mode.

Treat `visualize` and any shell redirection that creates or overwrites reports or exports as filesystem mutations. Require the same approval boundary.

Deletion remains approval-gated even though GoodLinks moves deleted links to trash. Before `dedupe --delete`, show which duplicate groups will be affected and that the oldest saved copy is retained.

## Failure recovery

- If `goodlinks` is unavailable, explain the install command and ask before installing it.
- If authentication fails, explain credential resolution without asking to see the token.
- If the API is unavailable, ask the user to confirm GoodLinks is running and its local API is enabled, then verify the base URL.
- If a write fails, do not retry automatically. Re-run the inspection or dry-run because a looped bulk command may have partly succeeded.
- If packaged skill files are missing, recommend reinstalling the same npm version before upgrading or fetching unrelated remote content.
- If the generated reference is stale, fail the repository check and print the exact generation command.

## Version parity

The current CLI hard-codes `0.1.0` in `src/cli.ts`, while the release workflow updates `package.json` with `pnpm version`. That can make `goodlinks --version` stale after a release.

Read the version from packaged `package.json`, pass it into `createProgram()`, and add a test asserting `goodlinks --version` equals `package.json`. This is in scope because users and agents need trustworthy evidence that skill content and binary behavior came from the same release.

## Packaging and distribution

Add `skills` and `skill-data` to the npm `files` allowlist. Keep the existing `dist`, `templates`, `README.md`, and `LICENSE` entries.

Document these distribution paths:

```sh
npx skills add berrydev-ai/goodlinks-cli --list
npx skills add berrydev-ai/goodlinks-cli --skill goodlinks-cli
goodlinks skills get core
```

The first two commands install the small bootstrap into a supported agent location. The third command is the installer-independent fallback and returns detailed instructions from the installed npm package.

Do not add copied agent-specific directories. The installer is responsible for mapping the portable bootstrap to Codex, Claude Code, Copilot, Cursor, or another supported host.

## Testing strategy

Follow test-driven development: write each focused failing test, prove the failure, implement the smallest behavior, and rerun the narrow test before the full suite.

### Program and version tests

- Assert `createProgram()` exposes the expected top-level and nested command tree.
- Assert the new `skills` command group appears in top-level help.
- Assert `goodlinks --version` equals `package.json`.

### Skill runtime tests

- `skills list` returns `core` and its parsed description.
- `skills get core` returns only the canonical `SKILL.md`.
- `skills get core --full` includes the command reference once with the exact resource marker.
- `skills path` and `skills path core` return existing absolute paths.
- Unknown skills, invalid frontmatter, and missing data roots exit nonzero with stable safe errors.
- Skill commands succeed without GoodLinks running and without credentials.

### Generated-reference tests

- Check mode passes on the committed reference.
- A controlled in-test program change produces a mismatch.
- The reference contains every registered command and representative options, defaults, and choices.

### Skill-format tests

- Run the skill creator's validator against both skill directories during implementation.
- Add a repository-owned check for required frontmatter, name constraints, directory-name matching, and bootstrap/runtime separation.
- Assert the bootstrap contains the exact runtime-load command and does not contain generated command sections.

### Package proof

The packed-package smoke script must:

1. build the CLI;
2. create an npm tarball in a temporary directory;
3. assert the tarball manifest includes the bootstrap, runtime skill, reference, `dist/cli.js`, and `package.json`;
4. extract the tarball;
5. run the packed `dist/cli.js` with `skills list`, `skills get core`, `skills get core --full`, `skills path core`, and `--version`;
6. remove the temporary directory even on failure.

It must not contact GoodLinks, use credentials, or leave a tarball in the repository.

### Agent forward tests

Use fresh Codex and Claude sessions with only the built skill and task-local context. Do not provide expected commands or conclusions. Cover:

- a request to search the library without changing it;
- a request to tag links from a discovered domain, which must stop after preview for approval;
- a request to remove duplicates, which must stop after the duplicate report and before deletion.

Review whether each agent loads the runtime skill, discovers exact help when needed, uses existing library values rather than invented data, protects credentials, and respects the approval boundary.

## Verification commands

The implementation plan must define exact scripts, but the completed feature must provide one full local verification path covering:

```sh
pnpm run typecheck
pnpm test
pnpm run build
pnpm run skill:check
pnpm run smoke:package
git diff --check
```

Run `npx skills add . --list` as a cross-agent discovery smoke check. Do not make it a required offline test because it depends on an external installer package.

## Documentation maintenance rule

When a user-facing command, argument, option, default, or choice changes:

1. update the Commander command tree and focused behavior tests;
2. regenerate `references/commands.md`;
3. update the handwritten runtime skill only when the workflow or safety guidance changes;
4. run the packed-package smoke test.

The bootstrap should change only when discovery, installation, or runtime-loading behavior changes.

## Risks and mitigations

- **Generated-reference drift:** fail check mode and show the regeneration command.
- **Source works but npm package fails:** execute skill commands from the packed artifact.
- **Agent ignores the bootstrap:** keep its description explicit and forward-test trigger prompts.
- **Agent writes without approval:** state the rule in the core workflow, mutation catalog, and forward-test assertions.
- **Credential exposure:** never inspect or echo secret sources; test skill commands without credentials.
- **Cross-agent metadata differences:** keep correct behavior in standard Markdown and make host-specific metadata optional.
- **Partial bulk write:** re-inspect before any retry and report that partial completion is possible.

## Acceptance checklist

- [ ] `npx skills add . --list` discovers `goodlinks-cli`.
- [ ] `goodlinks skills get core` returns the packaged runtime guide.
- [ ] `goodlinks skills get core --full` includes the generated command reference.
- [ ] `goodlinks skills path core` works from the packed npm artifact.
- [ ] The npm tarball contains both skill trees and the generated reference.
- [ ] `goodlinks --version` matches `package.json`.
- [ ] Reference check mode passes with no diff.
- [ ] All existing and new automated checks pass.
- [ ] Codex and Claude pass the read-only forward test.
- [ ] Codex and Claude stop for approval before tagging or deletion.
- [ ] README documents installation, runtime loading, and verification.
