import { mkdir, readFile, writeFile } from "node:fs/promises";

import { renderCommandReference } from "../src/command-reference.js";
import { readPackageVersion } from "../src/package-metadata.js";
import { createProgram } from "../src/program.js";

const referenceUrl = new URL(
  "../skill-data/core/references/commands.md",
  import.meta.url,
);

const main = async (): Promise<void> => {
  const rendered = renderCommandReference(
    createProgram(await readPackageVersion()),
  );
  if (process.argv.includes("--check")) {
    const committed = await readFile(referenceUrl, "utf8").catch(() => "");
    if (committed !== rendered) {
      throw new Error(
        "Bundled command reference is stale. Run: pnpm run skill:generate",
      );
    }
    process.stdout.write("bundled command reference is current\n");
    return;
  }
  await mkdir(new URL("../skill-data/core/references/", import.meta.url), {
    recursive: true,
  });
  await writeFile(referenceUrl, rendered);
  process.stdout.write("updated skill-data/core/references/commands.md\n");
};

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
