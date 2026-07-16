import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
) as {
  files: string[];
  scripts: Record<string, string>;
};

test("npm contract includes both skill trees and checks", () => {
  assert.deepEqual(packageJson.files, [
    "dist",
    "templates",
    "skills",
    "skill-data",
    "README.md",
    "LICENSE",
  ]);
  assert.equal(
    packageJson.scripts["skill:generate"],
    "node --import tsx scripts/generate-skill-reference.ts",
  );
  assert.equal(
    packageJson.scripts["skill:check"],
    "node --import tsx scripts/generate-skill-reference.ts --check",
  );
  assert.equal(
    packageJson.scripts["smoke:package"],
    "node --import tsx scripts/smoke-packed-skills.ts",
  );
});
