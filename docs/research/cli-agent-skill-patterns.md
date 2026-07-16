# Bundling an agent skill with `goodlinks`

Research date: 2026-07-16

## Recommendation

Use the **thin bootstrap plus runtime skill** pattern used by `agent-browser`,
`agent-tty`, and Metabase CLI:

```text
skills/
  goodlinks-cli/
    SKILL.md                 # small, stable discovery/bootstrap skill
skill-data/
  core/
    SKILL.md                 # canonical workflow served by the installed CLI
    references/
      commands.md            # generated command reference
```

- Add `skills` and `skill-data` to the npm package's `files` list.
- Add `goodlinks skills list|get|path`; make `goodlinks skills get core --full`
  include the reference files.
- Keep the public bootstrap small. It should tell an agent to run
  `goodlinks skills get core` before using the CLI. The detailed instructions
  then always come from the same npm version as the binary.
- Publish the bootstrap in the conventional `skills/<name>/SKILL.md` layout so
  `npx skills add berrydev-ai/goodlinks-cli` can discover and install it for
  Codex, Claude Code, Copilot, Cursor, and other supported agents.
- Generate `references/commands.md` from the Commander command tree or
  deterministic `--help` output. Fail CI if regeneration changes a committed
  file.

This gives the repo one public, cross-agent entry point and one version-locked
source of truth. It avoids copying a long command guide into several agent
folders, where it would drift after a CLI update.

## Baseline: the shared Agent Skills format

The open Agent Skills specification defines a skill as a directory containing
`SKILL.md`, with optional `scripts/`, `references/`, and `assets/`. `name` and
`description` are required; the recommended loading model is progressive:
metadata is always visible, `SKILL.md` loads when selected, and resources load
only when needed. The specification recommends keeping `SKILL.md` under 500
lines and provides `skills-ref validate` for structural validation.
([specification](https://agentskills.io/specification))

The portable core is intentionally small. Host-specific frontmatter should not
be required for correct use: the spec marks `allowed-tools` experimental and
notes that support varies between agents.

Discovery paths still differ by host:

- Codex scans repository `.agents/skills` paths from the current directory to
  the repository root, and loads the full skill only after its metadata
  matches a task. ([OpenAI Codex skills docs](https://developers.openai.com/codex/skills))
- Claude Code uses project `.claude/skills/<name>/SKILL.md`, user
  `~/.claude/skills`, and plugin `skills/` directories. It states that its
  skills follow the open standard but add Claude-only controls.
  ([Claude Code skills docs](https://code.claude.com/docs/en/skills))
- GitHub Copilot accepts `.github/skills`, `.agents/skills`, and
  `.claude/skills` for project skills.
  ([GitHub Copilot CLI docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills))

Therefore, author one standard skill and let an installer place it for each
host. Do not commit independent copies for every host.

## Primary-source examples

### 1. `agent-browser`: thin public stub, canonical runtime content

`agent-browser` ships two skill trees:

- `skills/agent-browser/SKILL.md` is a hidden discovery stub. It tells agents
  to fetch the real guide with `agent-browser skills get core`.
  ([stub](https://github.com/vercel-labs/agent-browser/blob/main/skills/agent-browser/SKILL.md))
- `skill-data/core/SKILL.md` and its `references/` and `templates/` contain the
  detailed runtime material.
  ([core skill](https://github.com/vercel-labs/agent-browser/blob/main/skill-data/core/SKILL.md))

The npm package explicitly includes both directories. The Rust CLI discovers
them, parses frontmatter, hides bootstrap-only skills from normal listings, and
implements `skills list`, `get`, `get --full`, and `path`.
([package manifest](https://github.com/vercel-labs/agent-browser/blob/main/package.json),
[runtime implementation](https://github.com/vercel-labs/agent-browser/blob/main/cli/src/skills.rs))

Drift is prevented by serving the detailed content from the installed package,
not by trusting a copied guide. Validation covers two levels:

- Unit tests in the runtime verify frontmatter parsing, discovery across
  directories, hidden skills, Unicode-safe descriptions, and supplementary
  resource collection.
- Agent evaluations run both Claude and Codex and test skill loading, skill
  selection, valid command usage, and context size.
  ([eval design](https://github.com/vercel-labs/agent-browser/blob/main/evals/README.md),
  [selection cases](https://github.com/vercel-labs/agent-browser/blob/main/evals/cases/skill-selection.ts))

The detailed command reference appears handwritten; no generator was found in
the official source. Runtime version-locking prevents package/skill mismatch,
but it does not by itself prove every documented flag matches parser metadata.

### 2. `agent-tty`: the same pattern with release-artifact proof

`agent-tty` documents the same split explicitly: `skills/agent-tty` is the thin
public bootstrap and `skill-data/` is canonical content served through
`agent-tty skills list|get`. Both are included in the npm package and GitHub
release tarball. Its docs recommend copying only the bootstrap or installing it
through a skill loader, so detailed instructions remain aligned with the
installed binary.
([Agent Skills documentation](https://github.com/coder/agent-tty/blob/main/docs/AGENT-SKILLS.md))

The repository also keeps package-level dogfood evidence: packed tarball file
lists and recorded runs of `skills list`, `get`, and `path`. That is a useful
release check beyond source-tree tests.
([runtime-refactor dogfood artifacts](https://github.com/coder/agent-tty/tree/main/dogfood/20260413-skills-runtime-refactor))

### 3. Metabase CLI: strongest full reference for this repo

Metabase CLI applies the same architecture to a TypeScript npm CLI:

- `skills/metabase-cli/SKILL.md` is the public discovery stub.
- `skill-data/` contains `core` plus focused skills and references for MBQL,
  SQL, dashboards, metadata, transforms, notifications, documents, and git
  sync.
- `mb skills list|get|path` serves the installed package's content; `--full`
  includes references and templates.
- The same bootstrap is discoverable through a Claude plugin manifest and
  `npx skills add`.

These behaviors are documented in the official README's Skills section.
([README](https://github.com/metabase/metabase-cli/blob/main/README.md#skills))

Its package manifest ships `skills`, `skill-data`, and `.claude-plugin`, and
adds strict skill linting with `uvx skillsaw lint skill-data/ --strict`.
([package manifest](https://github.com/metabase/metabase-cli/blob/main/package.json))

Metabase also exposes machine-readable `mb <command> --help --json`, including
arguments, examples, capabilities, and input/output JSON Schemas. This is a
better source for generated agent references than scraping styled text help.
The repo has unit tests for the skills runtime and end-to-end tests for the
published behavior.
([skills runtime](https://github.com/metabase/metabase-cli/blob/main/src/core/skills.ts),
[skills unit tests](https://github.com/metabase/metabase-cli/blob/main/src/core/skills.test.ts),
[skills end-to-end tests](https://github.com/metabase/metabase-cli/blob/main/tests/e2e/skills.e2e.test.ts))

### 4. Playwright CLI: copy installation plus mismatch detection

Playwright CLI takes a different approach. `playwright-cli install --skills`
copies the bundled skill into `.claude/skills/playwright-cli`, while
`--skills=agents` targets `.agents/skills/playwright-cli`.
([installer implementation](https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/tools/cli-daemon/program.ts),
[installer tests](https://github.com/microsoft/playwright/blob/main/tests/mcp/cli-misc.spec.ts))

Because a copy can become stale, the wrapper compares an installed `SKILL.md`
with the bundled copy on normal runs and tells the user to reinstall when they
differ. Its integration tests cover stale content and normalized line endings.
([mismatch check](https://github.com/microsoft/playwright-cli/blob/main/skillCheck.js),
[integration tests](https://github.com/microsoft/playwright-cli/blob/main/tests/integration.spec.ts))

The standalone repository refreshes its checked-in skill by running its own
installer and copying the generated result back into `skills/`.
([update script](https://github.com/microsoft/playwright-cli/blob/main/scripts/update.js))

This is simpler than runtime skill serving, but it needs agent-path choices and
an explicit stale-copy warning. It is a useful fallback, not the preferred
design for `goodlinks`.

### 5. Context Hub: static bundle, then cross-agent bootstrap

Context Hub's CLI ships `cli/skills/get-api-docs/SKILL.md` and documents manual
copying into Claude or Cursor locations. This makes the skill available without
adding a skills command, but every copy is independent.
([CLI docs](https://github.com/andrewyng/context-hub/blob/main/cli/README.md),
[bundled skill](https://github.com/andrewyng/context-hub/blob/main/cli/skills/get-api-docs/SKILL.md))

Its separate `context-hub-skill` repo improves distribution: a standard
`skills/context-hub/SKILL.md` is installed by `npx skills add` for Claude Code,
Cursor, Codex, or auto-detected agents. The bootstrap starts by running
`chub help`, so current CLI guidance wins over model memory.
([skill repository](https://github.com/andrewyng/context-hub-skill),
[bootstrap skill](https://github.com/andrewyng/context-hub-skill/blob/main/skills/context-hub/SKILL.md))

For `goodlinks`, keep that public skill in this repository rather than splitting
it into a second repository.

## Distribution and discovery

The Vercel `skills` CLI scans repositories for `skills/`, `.agents/skills/`,
`.claude/skills/`, and other known containers. It supports project or global
installation, agent targeting, and either a canonical symlink or copied files.
Its current agent table maps Codex project installs to `.agents/skills` and
Claude Code project installs to `.claude/skills`.
([README](https://github.com/vercel-labs/skills/blob/main/README.md),
[agent path registry](https://github.com/vercel-labs/skills/blob/main/src/agents.ts))

This means a repository-owned `skills/goodlinks-cli/SKILL.md` is a neutral
publishing location even though most agents will not auto-discover that folder
directly. Installation is the bridge:

```sh
npx skills add berrydev-ai/goodlinks-cli --list
npx skills add berrydev-ai/goodlinks-cli --skill goodlinks-cli
```

The README should also document a no-installer fallback: ask the agent to run
`goodlinks skills get core`, or copy the bootstrap directory from the installed
npm package to the host's skill location.

## Generated versus handwritten content

Use both, with a clear boundary:

- **Handwrite `SKILL.md`**: triggering description, safety rules, GoodLinks
  concepts, task recipes, dry-run-first guidance, and recovery steps require
  judgment.
- **Generate `references/commands.md`**: command names, arguments, option names,
  defaults, enum values, and help descriptions already belong to the CLI parser
  and should not be maintained twice.
- **Do not generate from the README**: prose examples are not a complete command
  contract and can already lag code.
- **Prefer structured help**: expose a machine-readable command tree if the
  Commander model can be serialized cleanly. Otherwise generate from the
  in-memory `Command` tree, not subprocess output that can vary by terminal.

## Proposed validation gates

1. **Format**: run `skills-ref validate skills/goodlinks-cli` and validate every
   runtime skill. Use only standard-required frontmatter for portability.
2. **Reference drift**: run the generator in `--check` mode; fail if
   `references/commands.md` differs.
3. **CLI behavior**: test `skills list`, `get core`, `get core --full`, `path`,
   unknown names, JSON output if offered, and package-root resolution.
4. **Bootstrap behavior**: assert the public stub names the exact runtime load
   command and does not duplicate the detailed command guide.
5. **Packaged artifact**: run `pnpm pack --dry-run` and assert the bootstrap,
   runtime skill, and references are present.
6. **Agent smoke tests**: give Codex and Claude at least three tasks—read/search,
   a dry-run write workflow, and a destructive request—and assert they load the
   skill, discover live help, preserve tokens, and require an explicit write
   step where appropriate.

## Three implementation options

| Option | Benefit | Cost | Fit |
| --- | --- | --- | --- |
| Standard `skills/` directory only | Smallest change; `npx skills add` works | Long installed copies can drift from upgraded CLI | Good first prototype |
| Playwright-style `install --skills` plus mismatch check | Direct install and clear stale warning | Must maintain host paths and copy lifecycle | Acceptable fallback |
| Thin public bootstrap plus `goodlinks skills get` | Version-locked content, agent-neutral, scalable references | Adds a small read-only CLI command group | **Recommended** |

## Repo-specific implications

This repository already has one useful seam: `tests/help.test.ts` checks top-level
command discovery, but `src/cli.ts` constructs and immediately parses the
Commander program. The implementation plan should first extract a pure
`createProgram()` function. That makes command-reference generation and help
tests deterministic without invoking GoodLinks or reading credentials.

The current npm `files` list contains only `dist`, `templates`, `README.md`, and
`LICENSE`; skill directories will not ship until that list changes. The skill
work should include an npm-pack assertion so a locally passing skill cannot be
silently omitted from releases.
