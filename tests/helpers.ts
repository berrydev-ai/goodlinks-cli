import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type CliResult = {
  exitCode: number;
  stderr: string;
  stdout: string;
};

export type ApiRequest = {
  body: unknown;
  headers: IncomingMessage["headers"];
  method: string;
  url: URL;
};

export type ApiResponder = (
  request: ApiRequest,
  response: ServerResponse,
) => void | Promise<void>;

/** Starts a local HTTP server that records requests made by the CLI. */
export const startApiServer = async (responder: ApiResponder) => {
  const requests: ApiRequest[] = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk));
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    const apiRequest: ApiRequest = {
      body: rawBody ? JSON.parse(rawBody) : undefined,
      headers: request.headers,
      method: request.method ?? "GET",
      url: new URL(request.url ?? "/", "http://localhost"),
    };
    requests.push(apiRequest);
    await responder(apiRequest, response);
  });

  await new Promise<void>((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test API server did not bind to a TCP port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/v1`,
    close: () =>
      new Promise<void>((resolveClose, reject) => {
        server.close((error) => (error ? reject(error) : resolveClose()));
      }),
    requests,
  };
};

/** Runs the TypeScript CLI through its real process boundary. */
export const runCli = async (
  args: string[],
  environment: NodeJS.ProcessEnv = {},
): Promise<CliResult> => {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", resolve(root, "src/cli.ts"), ...args],
    {
      cwd: root,
      env: { ...process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number>((resolveExit, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolveExit(code ?? 1));
  });

  return { exitCode, stderr, stdout };
};
