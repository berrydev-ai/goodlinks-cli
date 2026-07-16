import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const guard = new URL("../scripts/agent-skill-eval-guard.ts", import.meta.url);

const runGuard = (args: string[], env: NodeJS.ProcessEnv) =>
  execFile(process.execPath, ["--import", "tsx", guard.pathname, ...args], {
    env,
  });

const createGuardFixture = async (t: TestContext) => {
  const directory = await mkdtemp(join(tmpdir(), "goodlinks-eval-guard-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const log = join(directory, "blocked.jsonl");
  return {
    directory,
    env: {
      ...process.env,
      GOODLINKS_EVAL_LOG: log,
      GOODLINKS_REAL_CLI: "/usr/bin/true",
    },
    log,
  };
};

test("evaluation guard delegates reads and blocks mutation classes", async (t) => {
  const { env, log } = await createGuardFixture(t);

  for (const args of [
    ["links", "search", "--limit", "5"],
    ["links", "content", "discovered", "--no-auto-download"],
    [
      "tag-domain",
      "--domain",
      "discovered.invalid",
      "--tag",
      "existing",
      "--dry-run",
    ],
    ["dedupe", "--json"],
    ["dead-links", "--all", "--json"],
  ]) {
    await runGuard(args, env);
  }

  for (const args of [
    ["links", "add", "https://blocked.invalid"],
    ["links", "edit", "blocked"],
    ["links", "delete", "blocked"],
    [
      "links",
      "--base-url",
      "http://localhost:9428/api/v1",
      "add",
      "https://blocked.invalid",
    ],
    [
      "highlights",
      "--token=blocked-secret",
      "edit",
      "blocked",
      "--clear-note",
    ],
    ["links", "content", "blocked"],
    ["highlights", "edit", "blocked", "--clear-note"],
    ["tag-domain", "--domain", "blocked.invalid", "--tag", "blocked"],
    ["dedupe", "--delete"],
    ["dead-links", "--all"],
    ["auto-tag"],
    ["untag", "--tag", "blocked", "--domain", "blocked.invalid"],
    ["retag", "--from", "blocked", "--to", "still-blocked"],
    ["bulk-tag", "--file", "blocked.yaml"],
    ["visualize"],
  ]) {
    await assert.rejects(
      runGuard(args, env),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === 77,
    );
  }
  assert.equal((await readFile(log, "utf8")).trim().split("\n").length, 15);
});

test("evaluation guard redacts tokens in blocked logs", async (t) => {
  const { env, log } = await createGuardFixture(t);

  for (const args of [
    ["links", "--token", "separate-secret", "add", "https://blocked.invalid"],
    ["links", "--token=joined-secret", "delete", "blocked"],
  ]) {
    await assert.rejects(runGuard(args, env));
  }

  const blocked = await readFile(log, "utf8");
  assert.doesNotMatch(blocked, /separate-secret|joined-secret/);
  assert.match(blocked, /\[redacted\]/);
});

test("evaluation guard requires the real CLI for reads", async () => {
  const { GOODLINKS_REAL_CLI: _, ...env } = process.env;

  await assert.rejects(
    runGuard(["links", "search", "--limit", "5"], env),
    /GOODLINKS_REAL_CLI is required for agent skill evaluation/,
  );
});

test("evaluation guard runs through a symlink from a fresh session", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "goodlinks-eval-guard-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const shim = join(directory, "goodlinks");
  await symlink(guard, shim);

  await execFile(shim, ["links", "search", "--limit", "5"], {
    cwd: directory,
    env: {
      ...process.env,
      GOODLINKS_REAL_CLI: "/usr/bin/true",
      PATH: `${join(process.cwd(), "node_modules", ".bin")}:${process.env.PATH ?? ""}`,
    },
  });
});
