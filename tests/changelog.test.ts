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

test("released content keeps intentional blank lines byte-for-byte", async () => {
  const releasedContent = `## [0.1.0] - 2026-07-16

### Added

- Documented behavior:

  First paragraph.


  Second paragraph.
`;
  const result = await runGenerator(
    mergedPullRequest,
    `${initialChangelog}\n${releasedContent}`,
  );

  const releasedIndex = result.changelog.indexOf("## [0.1.0]");
  assert.notEqual(releasedIndex, -1);
  assert.equal(result.changelog.slice(releasedIndex), releasedContent);
});

test("new final Unreleased category keeps a blank line before the release", async () => {
  const releasedContent = `## [0.1.0] - 2026-07-16

- Existing release.
`;
  const result = await runGenerator(
    mergedPullRequest,
    `${initialChangelog}\n${releasedContent}`,
  );

  const releasedIndex = result.changelog.indexOf("## [0.1.0]");
  assert.notEqual(releasedIndex, -1);
  assert.match(
    result.changelog,
    /- Bundle a version-matched agent skill \(\[#2\]\(https:\/\/github\.com\/berrydev-ai\/goodlinks-cli\/pull\/2\)\)\n\n## \[0\.1\.0\]/,
  );
  assert.equal(result.changelog.slice(releasedIndex), releasedContent);
});

test("empty final Unreleased category keeps a blank line before the release", async () => {
  const releasedContent = `## [0.1.0] - 2026-07-16

- Existing release.
`;
  const result = await runGenerator(
    mergedPullRequest,
    `${initialChangelog}\n### Added\n\n${releasedContent}`,
  );

  const releasedIndex = result.changelog.indexOf("## [0.1.0]");
  assert.notEqual(releasedIndex, -1);
  assert.match(
    result.changelog,
    /### Added\n\n- Bundle a version-matched agent skill \(\[#2\]\(https:\/\/github\.com\/berrydev-ai\/goodlinks-cli\/pull\/2\)\)\n\n## \[0\.1\.0\]/,
  );
  assert.equal(result.changelog.slice(releasedIndex), releasedContent);
});

test("existing Unreleased content keeps intentional blank lines byte-for-byte", async () => {
  const existingContent = `### Changed

- Documented behavior:

  First paragraph.


  Second paragraph.


`;
  const releasedContent = `## [0.1.0] - 2026-07-16

- Existing release.
`;
  const result = await runGenerator(
    mergedPullRequest,
    `${initialChangelog}\n${existingContent}${releasedContent}`,
  );

  const existingIndex = result.changelog.indexOf("### Changed");
  const releasedIndex = result.changelog.indexOf("## [0.1.0]");
  assert.notEqual(existingIndex, -1);
  assert.notEqual(releasedIndex, -1);
  assert.equal(result.changelog.slice(existingIndex, releasedIndex), existingContent);
  assert.equal(result.changelog.slice(releasedIndex), releasedContent);
  assert.match(result.changelog, /goodlinks-cli\/pull\/2\)\)\n\n### Changed/);
});

test("repeated event does not duplicate its entry", async () => {
  const first = await runGenerator(mergedPullRequest);
  const second = await runGenerator(mergedPullRequest, first.changelog);
  assert.equal(second.output.trim(), "changed=false");
  assert.equal(second.changelog.match(/goodlinks-cli\/pull\/2/g)?.length, 1);
});

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

test("missing merged field fails with a useful message", async () => {
  const result = await runGenerator({
    ...mergedPullRequest,
    pull_request: { ...mergedPullRequest.pull_request, merged: undefined },
  });

  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /pull_request\.merged must be a boolean/);
  assert.equal(result.changelog, initialChangelog);
});

test("non-boolean merged field fails with a useful message", async () => {
  const result = await runGenerator({
    ...mergedPullRequest,
    pull_request: { ...mergedPullRequest.pull_request, merged: "true" },
  });

  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /pull_request\.merged must be a boolean/);
  assert.equal(result.changelog, initialChangelog);
});

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
