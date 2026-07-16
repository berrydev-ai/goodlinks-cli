import { Command } from "commander";

import { registerApiCommands } from "./commands/api.js";
import { registerBacklogCommands } from "./commands/backlog.js";
import { registerGardeningCommands } from "./commands/gardening.js";
import { registerSkillsCommands } from "./commands/skills.js";
import { registerVisualizeCommand } from "./commands/visualize.js";

/** Keeps command discovery reusable without parsing arguments or performing I/O. */
export const createProgram = (version: string): Command => {
  const program = new Command()
    .name("goodlinks")
    .description("Manage a local GoodLinks library from the command line")
    .version(version)
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
  registerSkillsCommands(program);
  return program;
};
