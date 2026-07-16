import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  listBundledSkills,
  readBundledSkill,
  resolveBundledSkillPath,
} from "../src/skills.js";
import { runCli } from "./helpers.js";

test("skills commands load content without GoodLinks or credential access", async (t) => {
  const canonical = await readFile(
    new URL("../skill-data/core/SKILL.md", import.meta.url),
    "utf8",
  );
  const temporary = await mkdtemp(join(tmpdir(), "goodlinks-skills-home-"));
  t.after(() => rm(temporary, { force: true, recursive: true }));
  const invalidHome = join(temporary, "not-a-directory");
  await writeFile(invalidHome, "credential lookup must not reach this path");
  const environment = { GOODLINKS_API: "", HOME: invalidHome };

  const listed = await runCli(["skills", "list"], environment);
  const loaded = await runCli(["skills", "get", "core"], environment);
  const full = await runCli(["skills", "get", "core", "--full"], {
    ...environment,
  });
  const rootPath = await runCli(["skills", "path"], environment);
  const corePath = await runCli(["skills", "path", "core"], environment);

  assert.equal(listed.exitCode, 0);
  assert.match(listed.stdout, /^core\tSafely inspect/m);
  assert.equal(loaded.stdout, canonical);
  assert.equal(
    full.stdout.match(/<!-- skill-resource: references\/commands\.md -->/g)?.length,
    1,
  );
  assert.equal((await stat(rootPath.stdout.trim())).isDirectory(), true);
  assert.equal((await stat(corePath.stdout.trim())).isDirectory(), true);
});

test("unknown skill returns the stable available-name error", async () => {
  const result = await runCli(["skills", "get", "missing"]);
  assert.equal(result.exitCode, 1);
  assert.equal(
    result.stderr,
    "Unknown bundled skill: missing. Available: core\n",
  );
  assert.equal(result.stdout, "");
});

test("registry sorts skills and nested references", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "goodlinks-skills-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  for (const name of ["zeta", "alpha"]) {
    await mkdir(join(root, name, "references", "nested"), { recursive: true });
    await writeFile(
      join(root, name, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${name} description\n---\n\n# ${name}\n`,
    );
  }
  await writeFile(join(root, "alpha", "references", "z.md"), "# Z\n");
  await writeFile(join(root, "alpha", "references", "nested", "a.md"), "# A\n");

  assert.deepEqual(await listBundledSkills(root), [
    { name: "alpha", description: "alpha description" },
    { name: "zeta", description: "zeta description" },
  ]);
  const full = await readBundledSkill("alpha", { full: true, root });
  assert.ok(full.indexOf("references/nested/a.md") < full.indexOf("references/z.md"));
  assert.equal(await resolveBundledSkillPath("alpha", root), join(root, "alpha"));
});

test("registry rejects missing roots and invalid frontmatter", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "goodlinks-skills-invalid-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  await assert.rejects(
    listBundledSkills(join(root, "missing")),
    /Bundled skill data is missing or unreadable in this npm installation/,
  );
  await mkdir(join(root, "broken"));
  await writeFile(join(root, "broken", "SKILL.md"), "---\nname: broken\n---\n");
  await assert.rejects(
    listBundledSkills(root),
    /Invalid bundled skill frontmatter: broken\/SKILL\.md/,
  );
});
