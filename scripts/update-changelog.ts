#!/usr/bin/env node

import { appendFile, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const CHANGELOG_CATEGORIES = [
  "Added", "Changed", "Deprecated", "Removed", "Fixed", "Security",
] as const;

export type ChangelogCategory = (typeof CHANGELOG_CATEGORIES)[number];

export type PullRequestMetadata = {
  action: string;
  baseRef: string;
  labels: string[];
  merged: boolean;
  number: number;
  title: string;
  url: string;
};

export type ChangelogUpdate = {
  category?: ChangelogCategory;
  changed: boolean;
  content: string;
  reason: string;
};

type CliArguments = {
  changelogPath: string;
  eventPath: string;
};

const asRecord = (value: unknown, label: string): Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
};

const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
};

const requiredBoolean = (value: unknown, label: string): boolean => {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`);
  }
  return value;
};

const requiredInteger = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }
  return value;
};

/** Parses the pull-request fields used by the changelog generator. */
export const parsePullRequestEvent = (value: unknown): PullRequestMetadata => {
  const event = asRecord(value, "GitHub event");
  const pullRequest = asRecord(event.pull_request, "pull_request");
  const base = asRecord(pullRequest.base, "pull_request.base");
  if (!Array.isArray(pullRequest.labels)) {
    throw new Error("pull_request.labels must be an array");
  }

  return {
    action: requiredString(event.action, "action"),
    baseRef: requiredString(base.ref, "pull_request.base.ref"),
    labels: pullRequest.labels.map((value, index) =>
      requiredString(
        asRecord(value, `pull_request.labels[${index}]`).name,
        `pull_request.labels[${index}].name`,
      ),
    ),
    merged: requiredBoolean(pullRequest.merged, "pull_request.merged"),
    number: requiredInteger(pullRequest.number, "pull_request.number"),
    title: requiredString(pullRequest.title, "pull_request.title"),
    url: requiredString(pullRequest.html_url, "pull_request.html_url"),
  };
};

const labelCategories: ReadonlyArray<readonly [string, ChangelogCategory]> = [
  ["security", "Security"],
  ["removed", "Removed"],
  ["deprecated", "Deprecated"],
  ["bug", "Fixed"],
  ["enhancement", "Added"],
];

const prefixCategories: ReadonlyArray<readonly [RegExp, ChangelogCategory]> = [
  [/^security(?:\([^)]*\))?!?:/i, "Security"],
  [/^remove(?:\([^)]*\))?!?:/i, "Removed"],
  [/^deprecate(?:\([^)]*\))?!?:/i, "Deprecated"],
  [/^fix(?:\([^)]*\))?!?:/i, "Fixed"],
  [/^feat(?:\([^)]*\))?!?:/i, "Added"],
];

/** Selects one Keep a Changelog category from explicit labels, then the title. */
export const categorizePullRequest = (
  pullRequest: PullRequestMetadata,
): ChangelogCategory => {
  const labels = new Set(pullRequest.labels.map((label) => label.toLowerCase()));
  for (const [label, category] of labelCategories) {
    if (labels.has(label)) return category;
  }
  for (const [pattern, category] of prefixCategories) {
    if (pattern.test(pullRequest.title)) return category;
  }
  return "Changed";
};

const entryTitle = (title: string): string => {
  const strippedTitle = title.replace(/^[a-z]+(?:\([^)]*\))?!?:\s*/i, "");
  return `${strippedTitle.charAt(0).toUpperCase()}${strippedTitle.slice(1)}`;
};

const insertionIndex = (
  lines: string[],
  unreleasedIndex: number,
  unreleasedEnd: number,
  category: ChangelogCategory,
): { index: number; newHeading: boolean } => {
  const heading = `### ${category}`;
  const categoryIndex = lines.findIndex(
    (line, index) => index > unreleasedIndex && index < unreleasedEnd && line === heading,
  );
  if (categoryIndex >= 0) {
    let index = categoryIndex + 1;
    while (index < unreleasedEnd && lines[index] === "") index += 1;
    return { index, newHeading: false };
  }

  const wantedOrder = CHANGELOG_CATEGORIES.indexOf(category);
  for (let index = unreleasedIndex + 1; index < unreleasedEnd; index += 1) {
    const existingOrder = CHANGELOG_CATEGORIES.indexOf(
      lines[index]?.replace(/^### /, "") as ChangelogCategory,
    );
    if (existingOrder > wantedOrder) return { index, newHeading: true };
  }
  return { index: unreleasedEnd, newHeading: true };
};

/** Adds one merged pull request to the Unreleased section when needed. */
export const updateChangelog = (
  changelog: string,
  pullRequest: PullRequestMetadata,
): ChangelogUpdate => {
  const unchanged = (reason: string): ChangelogUpdate => ({
    changed: false,
    content: `${changelog.trimEnd()}\n`,
    reason,
  });
  if (pullRequest.action !== "closed") return unchanged("event is not closed");
  if (!pullRequest.merged) return unchanged("pull request was not merged");
  if (pullRequest.baseRef !== "main") return unchanged("pull request does not target main");

  const pullRequestLink = `[#${pullRequest.number}](${pullRequest.url})`;
  if (changelog.includes(pullRequestLink)) {
    return unchanged(`pull request #${pullRequest.number} is already recorded`);
  }

  const unreleasedHeading = "## [Unreleased]";
  const unreleasedStart = changelog.indexOf(unreleasedHeading);
  if (unreleasedStart < 0) throw new Error("CHANGELOG.md must contain ## [Unreleased]");
  const afterUnreleasedHeading = unreleasedStart + unreleasedHeading.length;
  const nextVersionMatch = /\n## /.exec(changelog.slice(afterUnreleasedHeading));
  const releasedStart = nextVersionMatch
    ? afterUnreleasedHeading + nextVersionMatch.index + 1
    : changelog.length;
  const prefix = changelog.slice(0, unreleasedStart);
  const released = changelog.slice(releasedStart);
  const lines = changelog.slice(unreleasedStart, releasedStart).split("\n");
  const unreleasedIndex = 0;
  const unreleasedEnd = lines.length;
  const category = categorizePullRequest(pullRequest);
  const target = insertionIndex(lines, unreleasedIndex, unreleasedEnd, category);
  const entry = `- ${entryTitle(pullRequest.title)} (${pullRequestLink})`;

  if (target.newHeading) {
    let boundaryStart = target.index;
    while (boundaryStart > unreleasedIndex + 1 && lines[boundaryStart - 1] === "") {
      boundaryStart -= 1;
    }
    let boundaryEnd = target.index;
    while (boundaryEnd < unreleasedEnd && lines[boundaryEnd] === "") {
      boundaryEnd += 1;
    }
    const block = ["", `### ${category}`, "", entry, ""];
    lines.splice(boundaryStart, boundaryEnd - boundaryStart, ...block);
  } else {
    let boundaryStart = target.index;
    while (boundaryStart > unreleasedIndex + 1 && lines[boundaryStart - 1] === "") {
      boundaryStart -= 1;
    }
    const trailingBoundary = lines[target.index]?.startsWith("### ") ? [""] : [];
    lines.splice(boundaryStart, target.index - boundaryStart, "", entry, ...trailingBoundary);
  }

  const content = `${prefix}${lines.join("\n")}${released}`;

  return {
    category,
    changed: true,
    content,
    reason: `added pull request #${pullRequest.number} under ${category}`,
  };
};

const requiredFlagValue = (args: string[], index: number, flag: string): string => {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
};

const parseArguments = (args: string[]): CliArguments => {
  let eventPath = process.env.GITHUB_EVENT_PATH ?? "";
  let changelogPath = "CHANGELOG.md";
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--event-path") {
      eventPath = requiredFlagValue(args, index, flag);
      index += 1;
    } else if (flag === "--changelog") {
      changelogPath = requiredFlagValue(args, index, flag);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${flag}`);
    }
  }
  if (!eventPath) throw new Error("--event-path or GITHUB_EVENT_PATH is required");
  return { changelogPath, eventPath };
};

const writeChangedOutput = async (changed: boolean): Promise<void> => {
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
  }
};

const main = async (): Promise<void> => {
  const args = parseArguments(process.argv.slice(2));
  const event = JSON.parse(await readFile(args.eventPath, "utf8")) as unknown;
  const changelog = await readFile(args.changelogPath, "utf8");
  const result = updateChangelog(changelog, parsePullRequestEvent(event));
  if (result.changed) await writeFile(args.changelogPath, result.content);
  await writeChangedOutput(result.changed);
  console.log(result.reason);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
