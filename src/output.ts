/** Writes stable machine-readable JSON to stdout. */
export const writeJson = (value: unknown): void => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

/** Writes text to stdout while preserving existing line endings. */
export const writeText = (value: string): void => {
  process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
};
