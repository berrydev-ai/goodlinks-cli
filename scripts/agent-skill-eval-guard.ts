#!/usr/bin/env tsx

import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";

const args = process.argv.slice(2);
const has = (flag: string): boolean => args.includes(flag);

const commandArgs = (): string[] => {
  const values: string[] = [];
  let index = 0;
  while (index < args.length) {
    const value = args[index];
    if (value === undefined) {
      break;
    }
    if (value === "--base-url" || value === "--token") {
      index += 2;
    } else if (
      value.startsWith("--base-url=") ||
      value.startsWith("--token=")
    ) {
      index += 1;
    } else {
      values.push(value);
      index += 1;
    }
  }
  return values;
};

const [command, subcommand] = commandArgs();
const reportOnly = has("--dry-run") || has("--json");
const mutation =
  (command === "links" &&
    ["add", "edit", "delete"].includes(subcommand ?? "")) ||
  (command === "links" &&
    subcommand === "content" &&
    !has("--no-auto-download")) ||
  (command === "highlights" && subcommand === "edit") ||
  (command === "tag-domain" && !has("--dry-run")) ||
  (command === "dedupe" && has("--delete")) ||
  (["dead-links", "auto-tag", "untag", "retag", "bulk-tag"].includes(
    command ?? "",
  ) &&
    !reportOnly) ||
  command === "visualize";

const redacted = args.map((value, index) => {
  if (args[index - 1] === "--token") {
    return "[redacted]";
  }
  return value.startsWith("--token=") ? "--token=[redacted]" : value;
});

if (mutation) {
  const log = process.env.GOODLINKS_EVAL_LOG;
  if (log) {
    await appendFile(log, `${JSON.stringify({ args: redacted })}\n`);
  }
  process.stderr.write(
    "Blocked GoodLinks mutation during agent skill evaluation.\n",
  );
  process.exit(77);
}

const realCli = process.env.GOODLINKS_REAL_CLI;
if (!realCli) {
  throw new Error("GOODLINKS_REAL_CLI is required for agent skill evaluation");
}
const child = spawn(realCli, args, {
  env: process.env,
  stdio: "inherit",
});
child.once("error", (error) => {
  throw error;
});
child.once("close", (code) => {
  process.exitCode = code ?? 1;
});
