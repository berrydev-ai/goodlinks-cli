#!/usr/bin/env tsx

import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import type { Command } from "commander";

import { createProgram } from "../src/program.js";

const args = process.argv.slice(2);

type ResolvedCommand = {
  options: Record<string, unknown>;
  path: string[];
};

const configureParser = (command: Command): void => {
  command.exitOverride();
  command.configureOutput({
    writeErr: () => undefined,
    writeOut: () => undefined,
  });
  for (const child of command.commands) {
    configureParser(child);
  }
};

const findCommand = (command: Command, name: string): Command | undefined =>
  command.commands.find(
    (candidate) =>
      candidate.name() === name || candidate.aliases().includes(name),
  );

const resolveCommand = (argv: string[]): ResolvedCommand => {
  const program = createProgram("0.0.0");
  configureParser(program);

  let command = program;
  let operands: string[] = [];
  let unknown = argv;
  const path: string[] = [];

  while (true) {
    const parsed = command.parseOptions(unknown);
    operands = operands.concat(parsed.operands);
    unknown = parsed.unknown;
    const name = operands[0];
    const child = name === undefined ? undefined : findCommand(command, name);
    if (!child) {
      return { options: command.opts(), path };
    }
    path.push(child.name());
    command = child;
    operands = operands.slice(1);
  }
};

const isMutation = ({ options, path }: ResolvedCommand): boolean => {
  const [command, subcommand] = path;
  const reportOnly = options.dryRun === true || options.json === true;
  return (
    (command === "links" &&
      ["add", "edit", "delete"].includes(subcommand ?? "")) ||
    (command === "links" &&
      subcommand === "content" &&
      options.autoDownload !== false) ||
    (command === "highlights" && subcommand === "edit") ||
    (command === "tag-domain" && options.dryRun !== true) ||
    (command === "dedupe" &&
      options.delete === true &&
      options.json !== true) ||
    (["dead-links", "auto-tag", "untag", "retag", "bulk-tag"].includes(
      command ?? "",
    ) &&
      !reportOnly) ||
    command === "visualize"
  );
};

let mutation = true;
if (!args.includes("--")) {
  try {
    mutation = isMutation(resolveCommand(args));
  } catch {
    mutation = true;
  }
}

const redacted = args.map((value, index) => {
  if (args[index - 1] === "--token") {
    return "[redacted]";
  }
  return value.startsWith("--token=") ? "--token=[redacted]" : value;
});

if (mutation) {
  const log = process.env.GOODLINKS_EVAL_LOG;
  if (log) {
    try {
      await appendFile(log, `${JSON.stringify({ args: redacted })}\n`);
    } catch {
      process.stderr.write(
        "Unable to record blocked GoodLinks mutation attempt.\n",
      );
    }
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
let spawnFailed = false;
child.once("error", () => {
  spawnFailed = true;
  process.stderr.write(
    "Unable to start GoodLinks CLI for agent skill evaluation.\n",
  );
  process.exitCode = 1;
});
child.once("close", (code) => {
  if (!spawnFailed) {
    process.exitCode = code ?? 1;
  }
});
