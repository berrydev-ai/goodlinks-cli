import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export type BundledSkillSummary = {
  description: string;
  name: string;
};

type LoadedSkill = BundledSkillSummary & {
  directory: string;
  skillFile: string;
};

type ReadSkillOptions = {
  full?: boolean;
  root?: string;
};

const incomplete = (path: string): Error =>
  new Error(
    `Bundled skill data is missing or unreadable in this npm installation: ${path}`,
  );

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const assertDirectory = async (path: string): Promise<void> => {
  try {
    if (!(await stat(path)).isDirectory()) {
      throw incomplete(path);
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Bundled skill data")) {
      throw error;
    }
    throw incomplete(path);
  }
};

const readMetadata = async (
  root: string,
  directory: string,
): Promise<LoadedSkill> => {
  const skillFile = join(directory, "SKILL.md");
  let content: string;
  try {
    content = await readFile(skillFile, "utf8");
  } catch {
    throw incomplete(relative(root, skillFile));
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  const frontmatter = match?.[1];
  let value: unknown;
  try {
    value = frontmatter === undefined ? undefined : parse(frontmatter);
  } catch {
    value = undefined;
  }
  const expectedName = relative(root, directory);
  if (
    typeof value !== "object" ||
    value === null ||
    !("name" in value) ||
    !("description" in value) ||
    typeof value.name !== "string" ||
    typeof value.description !== "string" ||
    value.name !== expectedName ||
    value.description.trim() === ""
  ) {
    throw new Error(
      `Invalid bundled skill frontmatter: ${relative(root, skillFile)}`,
    );
  }
  return {
    name: value.name,
    description: value.description,
    directory,
    skillFile,
  };
};

const loadSkills = async (root: string): Promise<LoadedSkill[]> => {
  await assertDirectory(root);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => {
    throw incomplete(root);
  });
  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(root, entry.name))
    .sort();
  return Promise.all(
    directories.map((directory) => readMetadata(root, directory)),
  );
};

const references = async (
  directory: string,
  prefix = "references",
): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    (error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw incomplete(prefix);
    },
  );
  const found = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const absolute = join(directory, entry.name);
      const resource = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        return references(absolute, resource);
      }
      return entry.isFile() && entry.name.endsWith(".md") ? [resource] : [];
    }),
  );
  return found.flat().sort();
};

const findSkill = async (name: string, root: string): Promise<LoadedSkill> => {
  const skills = await loadSkills(root);
  const skill = skills.find((entry) => entry.name === name);
  if (!skill) {
    throw new Error(
      `Unknown bundled skill: ${name}. Available: ${skills.map((entry) => entry.name).join(", ")}`,
    );
  }
  return skill;
};

/** Resolves the packaged skill-data directory beside src or dist. */
export const bundledSkillDataRoot = (
  moduleUrl: string = import.meta.url,
): string => fileURLToPath(new URL("../skill-data", moduleUrl));

/** Lists bundled skills in stable name order. */
export const listBundledSkills = async (
  root: string = bundledSkillDataRoot(),
): Promise<BundledSkillSummary[]> =>
  (await loadSkills(root)).map(({ name, description }) => ({
    name,
    description,
  }));

/** Reads one bundled skill, optionally appending its Markdown references. */
export const readBundledSkill = async (
  name: string,
  options: ReadSkillOptions = {},
): Promise<string> => {
  const root = options.root ?? bundledSkillDataRoot();
  const skill = await findSkill(name, root);
  const content = await readFile(skill.skillFile, "utf8");
  if (!options.full) {
    return content;
  }
  const paths = await references(join(skill.directory, "references"));
  const resources = await Promise.all(
    paths.map(async (resource) => {
      const body = await readFile(join(skill.directory, resource), "utf8").catch(
        () => {
          throw incomplete(resource);
        },
      );
      return `<!-- skill-resource: ${resource} -->\n\n${body.trimEnd()}\n`;
    }),
  );
  return resources.length === 0
    ? content
    : `${content.trimEnd()}\n\n${resources.join("\n")}`;
};

/** Resolves the validated data root or one skill directory. */
export const resolveBundledSkillPath = async (
  name?: string,
  root: string = bundledSkillDataRoot(),
): Promise<string> => {
  if (name === undefined) {
    await assertDirectory(root);
    return root;
  }
  return (await findSkill(name, root)).directory;
};
