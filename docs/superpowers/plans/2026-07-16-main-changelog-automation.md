# Main Changelog Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically add every pull request merged into `main` to the standard `Unreleased` section in `CHANGELOG.md`.

**Architecture:** A dependency-free TypeScript command reads GitHub's pull-request event, performs a pure changelog transformation, writes a GitHub Actions output flag, and updates the file only when needed. A GitHub Actions workflow invokes that command after a merge and commits the resulting changelog change directly to `main`.

**Tech Stack:** Node.js 22, TypeScript 5.9, `node:test`, `tsx`, pnpm 10, GitHub Actions.

## Global Constraints

- Follow Keep a Changelog 1.1.0 headings and keep merged changes under `## [Unreleased]`.
- Do not create a release or Git tag for each merge.
- Prefer pull-request labels over title prefixes when selecting a category.
- Skip pull requests already linked in the changelog.
- Add JSDoc to every exported function.
- Do not add dependencies or change unrelated files.
- Do not read any non-example `.env` file.

---

## File Structure

- Create `CHANGELOG.md`: the committed Keep a Changelog document and command input.
- Create `scripts/update-changelog.ts`: event validation, category selection, changelog transformation, file I/O, and GitHub output handling.
- Create `tests/changelog.test.ts`: command-boundary tests using temporary files and the real PR #2 metadata.
- Create `.github/workflows/main-changelog.yml`: post-merge automation for `main`.
- Modify `package.json`: expose a local `changelog:update` command used by the workflow and maintainers.

### Task 1: Add the Keep a Changelog generator

**Files:**

- Create: `tests/changelog.test.ts`
- Create: `scripts/update-changelog.ts`
- Create: `CHANGELOG.md`

**Interfaces:**

- Consumes: GitHub `pull_request` event JSON, `GITHUB_EVENT_PATH`, `GITHUB_OUTPUT`, `--event-path`, and `--changelog`.
- Produces: `parsePullRequestEvent(value: unknown): PullRequestMetadata`, `categorizePullRequest(pr: PullRequestMetadata): ChangelogCategory`, `updateChangelog(changelog: string, pr: PullRequestMetadata): ChangelogUpdate`, and an executable command that writes `changed=true|false`.

- [ ] **Step 1: Write the failing command-boundary test for an Added entry**

Create `tests/changelog.test.ts` with a real process helper. Use the title, number, and URL from merged PR #2:

```ts
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const initialChangelog = `# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
`;

const mergedPullRequest = {
  action: "closed",
  pull_request: {
    base: { ref: "main" },
    html_url: "https://github.com/berrydev-ai/goodlinks-cli/pull/2",
    labels: [],
    merged: true,
    number: 2,
    title: "feat(cli): bundle a version-matched agent skill",
  },
};

const runGenerator = async (event: unknown, changelog = initialChangelog) => {
  const directory = await mkdtemp(resolve(tmpdir(), "goodlinks-changelog-"));
  const eventPath = resolve(directory, "event.json");
  const changelogPath = resolve(directory, "CHANGELOG.md");
  const outputPath = resolve(directory, "github-output.txt");
  await writeFile(eventPath, JSON.stringify(event));
  await writeFile(changelogPath, changelog);

  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      resolve(root, "scripts/update-changelog.ts"),
      "--event-path",
      eventPath,
      "--changelog",
      changelogPath,
    ],
    {
      cwd: root,
      env: { ...process.env, GITHUB_OUTPUT: outputPath },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolveExit(code ?? 1));
  });

  const result = {
    changelog: await readFile(changelogPath, "utf8"),
    exitCode,
    output: await readFile(outputPath, "utf8").catch(() => ""),
    stderr,
    stdout,
  };
  await rm(directory, { force: true, recursive: true });
  return result;
};

test("merged feature PR is added to Unreleased", async () => {
  const result = await runGenerator(mergedPullRequest);

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.match(result.output, /^changed=true$/m);
  assert.match(
    result.changelog,
    /## \[Unreleased\]\n\n### Added\n\n- Bundle a version-matched agent skill \(\[#2\]\(https:\/\/github\.com\/berrydev-ai\/goodlinks-cli\/pull\/2\)\)/,
  );
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `node --import tsx --test tests/changelog.test.ts`

Expected: FAIL because `scripts/update-changelog.ts` does not exist and the process exits non-zero.

- [ ] **Step 3: Add the initial changelog document**

Create `CHANGELOG.md`:

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]
```

- [ ] **Step 4: Implement the smallest command that passes the first test**

Create `scripts/update-changelog.ts` with this complete implementation:

```ts
#!/usr/bin/env node

import { appendFile, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const CHANGELOG_CATEGORIES = [
  "Added", "Changed", "Deprecated", "Removed", "Fixed", "Security",
] as const;

export type ChangelogCategory = (typeof CHANGELOG_CATEGORIES)[number];

export type PullRequestMetadata = {
  action: string;
  baseRef: string;
  labels: string[];
  merged: boolean;
  number: number;
  title: string;
  url: string;
};

export type ChangelogUpdate = {
  category?: ChangelogCategory;
  changed: boolean;
  content: string;
  reason: string;
};

type CliArguments = {
  changelogPath: string;
  eventPath: string;
};

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

const requiredInteger = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
  return value;
};

/** Parses the pull-request fields used by the changelog generator. */
export const parsePullRequestEvent = (value: unknown): PullRequestMetadata => {
  const event = asRecord(value, "GitHub event");
  const pullRequest = asRecord(event.pull_request, "pull_request");
  const base = asRecord(pullRequest.base, "pull_request.base");
  if (!Array.isArray(pullRequest.labels)) {
    throw new Error("pull_request.labels must be an array");
  }

  return {
    action: requiredString(event.action, "action"),
    baseRef: requiredString(base.ref, "pull_request.base.ref"),
    labels: pullRequest.labels.map((value, index) =>
      requiredString(
        asRecord(value, `pull_request.labels[${index}]`).name,
        `pull_request.labels[${index}].name`,
      ),
    ),
    merged: pullRequest.merged === true,
    number: requiredInteger(pullRequest.number, "pull_request.number"),
    title: requiredString(pullRequest.title, "pull_request.title"),
    url: requiredString(pullRequest.html_url, "pull_request.html_url"),
  };
};

const labelCategories: ReadonlyArray<readonly [string, ChangelogCategory]> = [
  ["security", "Security"],
  ["removed", "Removed"],
  ["deprecated", "Deprecated"],
  ["bug", "Fixed"],
  ["enhancement", "Added"],
];

const prefixCategories: ReadonlyArray<readonly [RegExp, ChangelogCategory]> = [
  [/^security(?:\([^)]*\))?!?:/i, "Security"],
  [/^remove(?:\([^)]*\))?!?:/i, "Removed"],
  [/^deprecate(?:\([^)]*\))?!?:/i, "Deprecated"],
  [/^fix(?:\([^)]*\))?!?:/i, "Fixed"],
  [/^feat(?:\([^)]*\))?!?:/i, "Added"],
];

/** Selects one Keep a Changelog category from explicit labels, then the title. */
export const categorizePullRequest = (
  pullRequest: PullRequestMetadata,
): ChangelogCategory => {
  const labels = new Set(pullRequest.labels.map((label) => label.toLowerCase()));
  for (const [label, category] of labelCategories) {
    if (labels.has(label)) return category;
  }
  for (const [pattern, category] of prefixCategories) {
    if (pattern.test(pullRequest.title)) return category;
  }
  return "Changed";
};

const entryTitle = (title: string): string =>
  title.replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/i, "");

const insertionIndex = (
  lines: string[],
  unreleasedIndex: number,
  unreleasedEnd: number,
  category: ChangelogCategory,
): { index: number; newHeading: boolean } => {
  const heading = `### ${category}`;
  const categoryIndex = lines.findIndex(
    (line, index) => index > unreleasedIndex && index < unreleasedEnd && line === heading,
  );
  if (categoryIndex >= 0) {
    let index = categoryIndex + 1;
    while (index < unreleasedEnd && lines[index] === "") index += 1;
    return { index, newHeading: false };
  }

  const wantedOrder = CHANGELOG_CATEGORIES.indexOf(category);
  for (let index = unreleasedIndex + 1; index < unreleasedEnd; index += 1) {
    const existingOrder = CHANGELOG_CATEGORIES.indexOf(
      lines[index]?.replace(/^### /, "") as ChangelogCategory,
    );
    if (existingOrder > wantedOrder) return { index, newHeading: true };
  }
  return { index: unreleasedEnd, newHeading: true };
};

/** Adds one merged pull request to the Unreleased section when needed. */
export const updateChangelog = (
  changelog: string,
  pullRequest: PullRequestMetadata,
): ChangelogUpdate => {
  const unchanged = (reason: string): ChangelogUpdate => ({
    changed: false,
    content: `${changelog.trimEnd()}\n`,
    reason,
  });
  if (pullRequest.action !== "closed") return unchanged("event is not closed");
  if (!pullRequest.merged) return unchanged("pull request was not merged");
  if (pullRequest.baseRef !== "main") return unchanged("pull request does not target main");

  const pullRequestLink = `[#${pullRequest.number}](${pullRequest.url})`;
  if (changelog.includes(pullRequestLink)) {
    return unchanged(`pull request #${pullRequest.number} is already recorded`);
  }

  const lines = changelog.trimEnd().split("\n");
  const unreleasedIndex = lines.indexOf("## [Unreleased]");
  if (unreleasedIndex < 0) throw new Error("CHANGELOG.md must contain ## [Unreleased]");
  const nextVersionOffset = lines
    .slice(unreleasedIndex + 1)
    .findIndex((line) => line.startsWith("## "));
  const unreleasedEnd = nextVersionOffset < 0
    ? lines.length
    : unreleasedIndex + 1 + nextVersionOffset;
  const category = categorizePullRequest(pullRequest);
  const target = insertionIndex(lines, unreleasedIndex, unreleasedEnd, category);
  const entry = `- ${entryTitle(pullRequest.title)} (${pullRequestLink})`;

  if (target.newHeading) {
    const block = ["", `### ${category}`, "", entry, ""];
    lines.splice(target.index, 0, ...block);
  } else {
    lines.splice(target.index, 0, entry);
  }

  return {
    category,
    changed: true,
    content: `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`,
    reason: `added pull request #${pullRequest.number} under ${category}`,
  };
};

const requiredFlagValue = (args: string[], index: number, flag: string): string => {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
};

const parseArguments = (args: string[]): CliArguments => {
  let eventPath = process.env.GITHUB_EVENT_PATH ?? "";
  let changelogPath = "CHANGELOG.md";
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--event-path") {
      eventPath = requiredFlagValue(args, index, flag);
      index += 1;
    } else if (flag === "--changelog") {
      changelogPath = requiredFlagValue(args, index, flag);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }
  if (!eventPath) throw new Error("--event-path or GITHUB_EVENT_PATH is required");
  return { changelogPath, eventPath };
};

const writeChangedOutput = async (changed: boolean): Promise<void> => {
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
  }
};

const main = async (): Promise<void> => {
  const args = parseArguments(process.argv.slice(2));
  const event = JSON.parse(await readFile(args.eventPath, "utf8")) as unknown;
  const changelog = await readFile(args.changelogPath, "utf8");
  const result = updateChangelog(changelog, parsePullRequestEvent(event));
  if (result.changed) await writeFile(args.changelogPath, result.content);
  await writeChangedOutput(result.changed);
  console.log(result.reason);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
```

- [ ] **Step 5: Run the focused test and verify green**

Run: `node --import tsx --test tests/changelog.test.ts`

Expected: PASS for `merged feature PR is added to Unreleased`.

- [ ] **Step 6: Add red tests for label priority, category order, and duplicate safety**

Append command-boundary tests that:

```ts
test("explicit labels override a conflicting title prefix", async () => {
  const result = await runGenerator({
    ...mergedPullRequest,
    pull_request: {
      ...mergedPullRequest.pull_request,
      labels: [{ name: "security" }],
    },
  });
  assert.match(result.changelog, /### Security\n\n- Bundle a version-matched agent skill/);
  assert.doesNotMatch(result.changelog, /### Added/);
});

test("title prefixes and fallback follow the agreed category map", async () => {
  const cases = [
    ["fix(cli): correct packaged skill path", "Fixed"],
    ["deprecate(cli): retire the legacy alias", "Deprecated"],
    ["remove(cli): drop the legacy alias", "Removed"],
    ["docs: explain packaged skills", "Changed"],
  ] as const;

  for (const [title, category] of cases) {
    const result = await runGenerator({
      ...mergedPullRequest,
      pull_request: { ...mergedPullRequest.pull_request, title },
    });
    assert.match(result.changelog, new RegExp(`### ${category}\\n\\n- `));
  }
});

test("missing headings are created in standard order", async () => {
  const changelog = `${initialChangelog}\n### Fixed\n\n- Existing correction.\n`;
  const result = await runGenerator(mergedPullRequest, changelog);
  assert.ok(result.changelog.indexOf("### Added") < result.changelog.indexOf("### Fixed"));
});

test("repeated event does not duplicate its entry", async () => {
  const first = await runGenerator(mergedPullRequest);
  const second = await runGenerator(mergedPullRequest, first.changelog);
  assert.equal(second.output.trim(), "changed=false");
  assert.equal(second.changelog.match(/goodlinks-cli\/pull\/2/g)?.length, 1);
});
```

- [ ] **Step 7: Run the tests and make the transformation rules pass**

Run: `node --import tsx --test tests/changelog.test.ts`

Expected: all five tests PASS with the category map, heading order, and duplicate behavior implemented in `scripts/update-changelog.ts`.

- [ ] **Step 8: Add red tests for skip behavior and malformed events**

Append these exact tests:

```ts
test("unmerged and non-main pull requests do not change the file", async () => {
  const unmerged = await runGenerator({
    ...mergedPullRequest,
    pull_request: { ...mergedPullRequest.pull_request, merged: false },
  });
  const nonMain = await runGenerator({
    ...mergedPullRequest,
    pull_request: {
      ...mergedPullRequest.pull_request,
      base: { ref: "staging" },
    },
  });

  for (const result of [unmerged, nonMain]) {
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.trim(), "changed=false");
    assert.equal(result.changelog, initialChangelog);
  }
});

test("malformed pull request event fails with a useful message", async () => {
  const result = await runGenerator({
    ...mergedPullRequest,
    pull_request: { ...mergedPullRequest.pull_request, title: undefined },
  });

  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /pull_request\.title must be a non-empty string/);
  assert.equal(result.changelog, initialChangelog);
});
```

- [ ] **Step 9: Run the focused tests and complete validation behavior**

Run: `node --import tsx --test tests/changelog.test.ts`

Expected: all changelog tests PASS with validation and skip behavior implemented in `scripts/update-changelog.ts`.

- [ ] **Step 10: Typecheck the generator and tests**

Run: `pnpm run typecheck`

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 11: Commit the generator slice**

```bash
git add CHANGELOG.md scripts/update-changelog.ts tests/changelog.test.ts
git commit -m "feat: generate unreleased changelog entries"
```

### Task 2: Add the main-branch GitHub workflow

**Files:**

- Create: `.github/workflows/main-changelog.yml`
- Modify: `package.json`

**Interfaces:**

- Consumes: `scripts/update-changelog.ts`, `GITHUB_EVENT_PATH`, and its `changed` GitHub output.
- Produces: the `pnpm run changelog:update` package command and a workflow that commits changed `CHANGELOG.md` content to `main`.

- [ ] **Step 1: Add a package contract test that fails before the workflow exists**

Append this exact test to `tests/changelog.test.ts`:

```ts
test("workflow runs the changelog command only after merges to main", async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  const workflow = await readFile(
    resolve(root, ".github/workflows/main-changelog.yml"),
    "utf8",
  );

  assert.equal(
    packageJson.scripts["changelog:update"],
    "node --import tsx scripts/update-changelog.ts",
  );
  assert.match(workflow, /pull_request:\n\s+types: \[closed\]/);
  assert.match(
    workflow,
    /github\.event\.pull_request\.merged == true && github\.event\.pull_request\.base\.ref == 'main'/,
  );
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /run: pnpm run changelog:update/);
  assert.match(workflow, /if: steps\.changelog\.outputs\.changed == 'true'/);
  assert.match(workflow, /git pull --rebase origin main/);
  assert.match(workflow, /git push origin HEAD:main/);
  assert.doesNotMatch(workflow, /git push origin .*tag/);
});
```

- [ ] **Step 2: Run the focused test and verify red**

Run: `node --import tsx --test tests/changelog.test.ts`

Expected: FAIL with missing `.github/workflows/main-changelog.yml` or missing `changelog:update`.

- [ ] **Step 3: Add the package command**

Add this key to `package.json` under `scripts`:

```json
"changelog:update": "node --import tsx scripts/update-changelog.ts"
```

- [ ] **Step 4: Add the merge workflow**

Create `.github/workflows/main-changelog.yml` with:

```yaml
name: Main Changelog

on:
  pull_request:
    types: [closed]

permissions:
  contents: read

concurrency:
  group: main-changelog
  cancel-in-progress: false

jobs:
  update-main-changelog:
    if: github.event.pull_request.merged == true && github.event.pull_request.base.ref == 'main'
    name: Update main changelog
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: read

    steps:
      - name: Checkout main
        uses: actions/checkout@v4
        with:
          ref: main
          fetch-depth: 0

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 10.29.3

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Configure Git author
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

      - name: Update changelog
        id: changelog
        run: pnpm run changelog:update

      - name: Commit changelog
        if: steps.changelog.outputs.changed == 'true'
        run: |
          git add CHANGELOG.md
          git commit -m "docs: update changelog for #${{ github.event.pull_request.number }}"

      - name: Push changelog commit
        if: steps.changelog.outputs.changed == 'true'
        run: |
          git pull --rebase origin main
          git push origin HEAD:main
```

- [ ] **Step 5: Run the focused tests and verify green**

Run: `node --import tsx --test tests/changelog.test.ts`

Expected: all changelog and workflow contract tests PASS.

- [ ] **Step 6: Commit the workflow slice**

```bash
git add .github/workflows/main-changelog.yml package.json tests/changelog.test.ts
git commit -m "ci: update changelog after main merges"
```

### Task 3: Verify and review the complete change

**Files:**

- Review: `CHANGELOG.md`
- Review: `scripts/update-changelog.ts`
- Review: `tests/changelog.test.ts`
- Review: `.github/workflows/main-changelog.yml`
- Review: `package.json`

**Interfaces:**

- Consumes: all Task 1 and Task 2 deliverables.
- Produces: a clean, reviewed branch with proof that the repository checks pass.

- [ ] **Step 1: Run the full repository check**

Run: `pnpm run check`

Expected: typecheck, all Node tests, build, and skill reference validation exit with code 0.

- [ ] **Step 2: Validate formatting and scope**

Run:

```bash
git diff --check origin/main...
git status --short
git diff --stat origin/main...
```

Expected: no whitespace errors; only the approved spec, plan, changelog generator, changelog test, workflow, and package script are changed.

- [ ] **Step 3: Review the implementation against the design**

Check every design requirement: category priority, standard heading order, exact duplicate detection, skip behavior, clear validation errors, guarded command execution, minimal permissions, serialized workflow, no tag creation, and the documented branch-rule constraint.

- [ ] **Step 4: Apply only evidence-backed review fixes**

If review finds a defect, add or adjust a failing test first, run the focused test to show red, make the smallest implementation change, and rerun the focused and full checks. Do not refactor unrelated code.

- [ ] **Step 5: Commit review fixes if needed**

```bash
git add CHANGELOG.md scripts/update-changelog.ts tests/changelog.test.ts .github/workflows/main-changelog.yml package.json
git commit -m "fix: harden changelog automation"
```

Skip this commit when review produces no code changes.
