import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { renderCommandReference } from "../src/command-reference.js";
import { createProgram } from "../src/program.js";

const referenceUrl = new URL(
  "../skill-data/core/references/commands.md",
  import.meta.url,
);

const paths = (
  command: ReturnType<typeof createProgram>,
  parent = "",
): string[] => {
  const path = parent ? `${parent} ${command.name()}` : command.name();
  return [path, ...command.commands.flatMap((child) => paths(child, path))];
};

test("reference renders every command and structured metadata", () => {
  const program = createProgram("0.1.0");
  const rendered = renderCommandReference(program);
  for (const path of paths(program)) {
    assert.match(rendered, new RegExp(`^## \\x60${path}\\x60$`, "m"));
  }
  assert.match(rendered, /--base-url <url>/);
  assert.match(rendered, /http:\/\/localhost:9428\/api\/v1/);
  assert.match(rendered, /html, plaintext, markdown/);
  assert.match(rendered, /newestSaved, oldestSaved/);
});

test("committed reference exactly matches Commander", async () => {
  const committed = await readFile(referenceUrl, "utf8");
  assert.equal(committed, renderCommandReference(createProgram("0.1.0")));
});

test("a controlled command change is detected as drift", async () => {
  const committed = await readFile(referenceUrl, "utf8");
  const program = createProgram("0.1.0");
  program.command("diagnose").description("Inspect local CLI readiness");
  const changed = renderCommandReference(program);
  assert.notEqual(changed, committed);
  assert.match(changed, /^## \x60goodlinks diagnose\x60$/m);
});
