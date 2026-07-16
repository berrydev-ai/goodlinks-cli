import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { InvalidArgumentError, type Command } from "commander";

import { createGoodLinksClient } from "../client.js";
import { resolveToken } from "../config.js";
import { domainOf, fetchAllLinks, type Link } from "../goodlinks.js";
import { writeText } from "../output.js";

type GlobalOptions = { baseUrl: string; token?: string };

type VisualizationDataset = {
  articles: Link[];
  heatmap: Record<string, number>;
  tag_series: Record<string, Record<string, number>>;
  domain_series: Record<string, Record<string, number>>;
};

const defaultTemplateDirectories = [
  fileURLToPath(new URL("../templates", import.meta.url)),
  fileURLToPath(new URL("../../templates", import.meta.url)),
];
const shortcodeNames = [
  "goodlinks-plotly",
  "goodlinks-heatmap",
  "goodlinks-sunburst",
  "goodlinks-table",
] as const;

const loadTemplates = async (templateDirectory?: string) => {
  let directory = templateDirectory;
  if (!directory) {
    for (const candidate of defaultTemplateDirectories) {
      if (await isDirectory(candidate)) {
        directory = candidate;
        break;
      }
    }
  }
  if (!directory) {
    throw new Error("Could not find bundled visualization templates");
  }
  const shortcodes = Object.fromEntries(
    await Promise.all(
      shortcodeNames.map(async (name) => [
        name,
        await readFile(join(directory, name + ".html"), "utf8"),
      ] as const),
    ),
  );
  return {
    index: await readFile(join(directory, "index.html"), "utf8"),
    shortcodes,
  };
};

/** Registers standalone and Hugo visualization generation. */
export const registerVisualizeCommand = (program: Command): void => {
  program
    .command("visualize")
    .description("Generate visualization data and HTML")
    .option(
      "--output-dir <path>",
      "Standalone output directory",
      "goodlinks-stats",
    )
    .option("--pretty", "Pretty-print JSON output")
    .option("--hugo-dir <path>", "Hugo project root")
    .option("--page-bundle <path>", "Hugo page bundle path")
    .option(
      "--template-dir <path>",
      "Directory containing index and shortcode templates",
    )
    .action(
      async (options: {
        hugoDir?: string;
        outputDir: string;
        pageBundle?: string;
        pretty?: boolean;
        templateDir?: string;
      }) => {
        if (options.hugoDir && !options.pageBundle) {
          throw new InvalidArgumentError(
            "--page-bundle is required with --hugo-dir",
          );
        }
        if (options.pageBundle && !options.hugoDir) {
          throw new InvalidArgumentError(
            "--hugo-dir is required with --page-bundle",
          );
        }
        const client = await clientFor(program);
        const dataset = buildDataset(await fetchAllLinks(client));
        const json =
          JSON.stringify(dataset, null, options.pretty ? 2 : undefined) + "\n";
        const templates = await loadTemplates(options.templateDir);

        const dataDirectory = join(options.outputDir, "data");
        await mkdir(dataDirectory, { recursive: true });
        await writeFile(join(dataDirectory, "goodlinks-data.json"), json);
        await writeFile(join(options.outputDir, "index.html"), templates.index);

        if (options.hugoDir && options.pageBundle) {
          if (!(await isDirectory(options.hugoDir))) {
            throw new InvalidArgumentError(
              "Hugo directory does not exist: " + options.hugoDir,
            );
          }
          const bundle = join(options.hugoDir, options.pageBundle);
          const shortcodes = join(options.hugoDir, "layouts", "shortcodes");
          await mkdir(bundle, { recursive: true });
          await mkdir(shortcodes, { recursive: true });
          await writeFile(join(bundle, "goodlinks-data.json"), json);
          await Promise.all(
            Object.entries(templates.shortcodes).map(([name, template]) =>
              writeFile(join(shortcodes, name + ".html"), template),
            ),
          );
        }

        writeText(
          "wrote visualization assets for " +
            dataset.articles.length +
            " link(s).",
        );
      },
    );
};

const clientFor = async (program: Command) => {
  const options = program.opts<GlobalOptions>();
  return createGoodLinksClient(options.baseUrl, await resolveToken(options.token));
};

const buildDataset = (links: Link[]): VisualizationDataset => {
  const heatmap: Record<string, number> = {};
  const tagSeries: Record<string, Record<string, number>> = {};
  const domainSeries: Record<string, Record<string, number>> = {};

  for (const link of links) {
    if (link.readAt) {
      const day = link.readAt.slice(0, 10);
      heatmap[day] = (heatmap[day] ?? 0) + 1;
    }
    const month = link.addedAt.slice(0, 7);
    for (const tag of link.tags ?? []) {
      incrementSeries(tagSeries, tag, month);
    }
    const domain = domainOf(link.url);
    if (domain) {
      incrementSeries(domainSeries, domain, month);
    }
  }

  return {
    articles: [...links].sort((left, right) =>
      (right.readAt ?? "").localeCompare(left.readAt ?? ""),
    ),
    heatmap,
    tag_series: tagSeries,
    domain_series: domainSeries,
  };
};

const incrementSeries = (
  series: Record<string, Record<string, number>>,
  name: string,
  month: string,
): void => {
  const values = series[name] ?? {};
  values[month] = (values[month] ?? 0) + 1;
  series[name] = values;
};

const isDirectory = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
};
