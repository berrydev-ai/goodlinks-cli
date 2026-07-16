#!/usr/bin/env node

import { Command } from "commander";

import { registerApiCommands } from "./commands/api.js";
import { registerBacklogCommands } from "./commands/backlog.js";
import { registerGardeningCommands } from "./commands/gardening.js";
import { registerVisualizeCommand } from "./commands/visualize.js";

const program = new Command()
  .name("goodlinks")
  .description("Manage a local GoodLinks library from the command line")
  .version("0.1.0")
  .option(
    "--base-url <url>",
    "GoodLinks API base URL",
    "http://localhost:9428/api/v1",
  )
  .option("--token <token>", "GoodLinks API bearer token");

const apiGroups = registerApiCommands(program);
registerGardeningCommands(program, apiGroups);
registerBacklogCommands(program);
registerVisualizeCommand(program);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
