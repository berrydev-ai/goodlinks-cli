import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createProgram } from "../src/program.js";
import { runCli } from "./helpers.js";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

test("program factory exposes the command tree without parsing", () => {
  const program = createProgram("9.8.7");
  assert.equal(program.name(), "goodlinks");
  assert.equal(program.version(), "9.8.7");
  assert.deepEqual(
    program.commands.map((command) => command.name()),
    [
      "links", "lists", "tags", "highlights", "urls", "tag-domain",
      "dedupe", "dead-links", "auto-tag", "untag", "retag", "bulk-tag",
      "report", "stale", "export", "visualize", "skills",
    ],
  );
});

test("user can discover API and collection commands", async () => {
  const result = await runCli(["--help"]);
  assert.equal(result.exitCode, 0);
  for (const name of ["links", "highlights", "tag-domain", "visualize"]) {
    assert.match(result.stdout, new RegExp(name));
  }
  assert.match(result.stdout, /skills/);
});

test("CLI version matches package.json", async () => {
  const result = await runCli(["--version"]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, `${packageJson.version}\n`);
});
