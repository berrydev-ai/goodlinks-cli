import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const run = async (
  command: string,
  args: string[],
  cwd: string,
): Promise<{ stderr: string; stdout: string }> =>
  execFile(command, args, {
    cwd,
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  });

const assertFile = async (path: string): Promise<void> => {
  assert.equal((await stat(path)).isFile(), true, `missing packed file: ${path}`);
};

const main = async (): Promise<void> => {
  const temporary = await mkdtemp(join(tmpdir(), "goodlinks-pack-"));
  try {
    await run("pnpm", ["run", "build"], root);
    await run("pnpm", ["pack", "--pack-destination", temporary], root);
    const [tarball, ...extraTarballs] = (await readdir(temporary)).filter((name) =>
      name.endsWith(".tgz"),
    );
    assert.ok(tarball);
    assert.equal(extraTarballs.length, 0);
    await run(
      "tar",
      ["-xzf", join(temporary, tarball), "-C", temporary],
      root,
    );

    const packedRoot = join(temporary, "package");
    for (const path of [
      "dist/cli.js",
      "package.json",
      "skills/goodlinks-cli/SKILL.md",
      "skills/goodlinks-cli/agents/openai.yaml",
      "skill-data/core/SKILL.md",
      "skill-data/core/references/commands.md",
    ]) {
      await assertFile(join(packedRoot, path));
    }

    await run(
      "pnpm",
      ["install", "--prod", "--offline", "--ignore-scripts"],
      packedRoot,
    );
    const home = join(temporary, "home");
    await mkdir(home);
    const packedCli = join(packedRoot, "dist", "cli.js");
    const runPacked = async (args: string[]) =>
      execFile(process.execPath, [packedCli, ...args], {
        cwd: packedRoot,
        env: { ...process.env, GOODLINKS_API: "", HOME: home },
        maxBuffer: 8 * 1024 * 1024,
      });

    const listed = await runPacked(["skills", "list"]);
    assert.match(listed.stdout, /^core\tSafely inspect/m);
    const core = await runPacked(["skills", "get", "core"]);
    assert.match(core.stdout, /^---\nname: core\n/);
    const full = await runPacked(["skills", "get", "core", "--full"]);
    assert.equal(
      full.stdout.match(/<!-- skill-resource: references\/commands\.md -->/g)
        ?.length,
      1,
    );
    const pathResult = await runPacked(["skills", "path", "core"]);
    assert.equal(
      await realpath(pathResult.stdout.trim()),
      await realpath(join(packedRoot, "skill-data", "core")),
    );

    const packageJson = JSON.parse(
      await readFile(join(packedRoot, "package.json"), "utf8"),
    ) as { version: string };
    const version = await runPacked(["--version"]);
    assert.equal(version.stdout, `${packageJson.version}\n`);
    process.stdout.write("packed GoodLinks skills smoke passed\n");
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
};

await main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
