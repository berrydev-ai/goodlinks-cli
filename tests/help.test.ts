import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "./helpers.js";

test("user can discover API and collection-management commands", async () => {
  const result = await runCli(["--help"]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Usage: goodlinks/);
  assert.match(result.stdout, /links/);
  assert.match(result.stdout, /highlights/);
  assert.match(result.stdout, /tag-domain/);
  assert.match(result.stdout, /visualize/);
});
