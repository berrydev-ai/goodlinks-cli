import type { Command } from "commander";

import {
  listBundledSkills,
  readBundledSkill,
  resolveBundledSkillPath,
} from "../skills.js";
import { writeText } from "../output.js";

/** Registers read-only commands for bundled, version-matched agent skills. */
export const registerSkillsCommands = (program: Command): void => {
  const skills = program
    .command("skills")
    .description("Inspect bundled agent skills");

  skills
    .command("list")
    .description("List bundled agent skills")
    .action(async () => {
      const summaries = await listBundledSkills();
      writeText(
        summaries.map((skill) => `${skill.name}\t${skill.description}`).join("\n"),
      );
    });

  skills
    .command("get <name>")
    .description("Print one bundled agent skill")
    .option("--full", "Append bundled Markdown references")
    .action(async (name: string, options: { full?: boolean }) => {
      writeText(
        await readBundledSkill(name, options.full ? { full: true } : {}),
      );
    });

  skills
    .command("path [name]")
    .description("Print the bundled skill-data path")
    .action(async (name?: string) => {
      writeText(await resolveBundledSkillPath(name));
    });
};
