#!/usr/bin/env node

import { readPackageVersion } from "./package-metadata.js";
import { createProgram } from "./program.js";

try {
  const program = createProgram(await readPackageVersion());
  await program.parseAsync(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
