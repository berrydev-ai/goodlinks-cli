import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.GOODLINKS_BASE_URL ?? "http://localhost:9428/api/v1";

if (!process.env.GOODLINKS_API?.trim()) {
  throw new Error("GOODLINKS_API is required for the live smoke test");
}

const runCli = async (args: string[]): Promise<unknown> => {
  const result = await execFile(
    process.execPath,
    [join(root, "dist", "cli.js"), "--base-url", baseUrl, ...args],
    { cwd: root, env: process.env, maxBuffer: 4 * 1024 * 1024 },
  );
  return JSON.parse(result.stdout);
};

const smokeUrl =
  "https://example.com/goodlinks-cli-smoke-" + Date.now().toString(36);
let linkId: string | undefined;

try {
  const added = (await runCli([
    "links",
    "add",
    smokeUrl,
    "--title",
    "GoodLinks CLI smoke test",
  ])) as { id?: string; url?: string };
  assert.equal(added.url, smokeUrl);
  const addedId = added.id;
  assert.ok(typeof addedId === "string");
  linkId = addedId;

  const edited = (await runCli([
    "links",
    "edit",
    addedId,
    "--title",
    "GoodLinks CLI smoke test edited",
  ])) as { id?: string; title?: string };
  assert.equal(edited.id, addedId);
  assert.equal(edited.title, "GoodLinks CLI smoke test edited");

  const fetched = (await runCli(["links", "get", addedId])) as {
    id?: string;
    title?: string;
  };
  assert.equal(fetched.id, addedId);
  assert.equal(fetched.title, "GoodLinks CLI smoke test edited");
} finally {
  if (linkId) {
    await runCli(["links", "delete", linkId]);
  }
}

process.stdout.write("live GoodLinks create/edit/get/delete smoke passed\n");
