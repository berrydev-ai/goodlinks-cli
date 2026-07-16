import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** Resolves the API token using file, environment, then CLI precedence. */
export const resolveToken = async (cliToken?: string): Promise<string | undefined> => {
  const home = process.env.HOME || homedir();
  let token: string | undefined;

  try {
    const fileToken = await readFile(
      join(home, ".credentials", "goodlinks-token.txt"),
      "utf8",
    );
    token = fileToken.trim() || undefined;
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }

  const environmentToken = process.env.GOODLINKS_API?.trim();
  if (environmentToken) {
    token = environmentToken;
  }
  if (cliToken?.trim()) {
    token = cliToken.trim();
  }

  return token;
};

const isMissingFile = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error && error.code === "ENOENT";
