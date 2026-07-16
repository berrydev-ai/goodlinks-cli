import { readFile } from "node:fs/promises";

/** Keeps CLI version output aligned with the adjacent package.json. */
export const readPackageVersion = async (
  moduleUrl: string = import.meta.url,
): Promise<string> => {
  const packageJson: unknown = JSON.parse(
    await readFile(new URL("../package.json", moduleUrl), "utf8"),
  );
  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    !("version" in packageJson) ||
    typeof packageJson.version !== "string" ||
    packageJson.version.trim() === ""
  ) {
    throw new Error("Invalid package version in package.json");
  }
  return packageJson.version;
};
