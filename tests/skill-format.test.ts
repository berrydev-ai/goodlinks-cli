import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parse } from "yaml";

type Frontmatter = { description: string; name: string };

const readSkill = async (url: URL): Promise<{
  body: string;
  frontmatter: Frontmatter;
}> => {
  const content = await readFile(url, "utf8");
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(content);
  if (!match || match[1] === undefined || match[2] === undefined) {
    assert.fail(`missing frontmatter in ${url.pathname}`);
  }
  const value: unknown = parse(match[1]);
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  const frontmatter = value as Record<string, unknown>;
  assert.deepEqual(Object.keys(frontmatter).sort(), ["description", "name"]);
  assert.equal(typeof frontmatter.name, "string");
  assert.equal(typeof frontmatter.description, "string");
  assert.match(frontmatter.name as string, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok((frontmatter.name as string).length <= 64);
  assert.ok((frontmatter.description as string).length <= 1024);
  assert.doesNotMatch(frontmatter.description as string, /[<>]/);
  return {
    body: match[2],
    frontmatter: frontmatter as Frontmatter,
  };
};

test("public bootstrap is portable, trigger-rich, and thin", async () => {
  const skill = await readSkill(
    new URL("../skills/goodlinks-cli/SKILL.md", import.meta.url),
  );
  assert.equal(skill.frontmatter.name, "goodlinks-cli");
  for (const trigger of [
    "reading", "searching", "adding", "editing", "tagging",
    "cleaning", "reporting", "exporting", "visualizing",
  ]) {
    assert.match(skill.frontmatter.description, new RegExp(trigger, "i"));
  }
  assert.match(skill.body, /goodlinks skills get core/);
  assert.match(skill.body, /goodlinks skills list/);
  assert.doesNotMatch(skill.body, /## Command reference/);
  assert.ok(skill.body.split("\n").length < 40);
});

test("runtime skill contains progressive disclosure and safety boundaries", async () => {
  const skill = await readSkill(
    new URL("../skill-data/core/SKILL.md", import.meta.url),
  );
  assert.equal(skill.frontmatter.name, "core");
  assert.ok(skill.body.split("\n").length < 500);
  assert.match(skill.body, /references\/commands\.md/);
  assert.match(skill.body, /explicit approval immediately before every mutation/i);
  assert.match(skill.body, /Never read or display.*token/i);
  assert.match(skill.body, /links content --no-auto-download/);
  assert.match(skill.body, /links add.*links edit.*links delete/s);
  assert.match(skill.body, /dedupe --delete/);
  assert.match(skill.body, /visualize/);
  assert.match(skill.body, /partly succeeded/i);
});
