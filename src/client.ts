type QueryValue = boolean | number | string | readonly string[] | undefined;

export type RequestOptions = {
  body?: unknown;
  query?: Readonly<Record<string, QueryValue>>;
  response?: "json" | "text" | "void";
};

export type GoodLinksClient = {
  request: <Result>(
    method: "DELETE" | "GET" | "PATCH" | "POST",
    path: string,
    options?: RequestOptions,
  ) => Promise<Result>;
};

/** Creates a small fetch-based client for the local GoodLinks REST API. */
export const createGoodLinksClient = (
  baseUrl: string,
  token?: string,
): GoodLinksClient => {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

  return {
    request: async <Result>(
      method: "DELETE" | "GET" | "PATCH" | "POST",
      path: string,
      options: RequestOptions = {},
    ): Promise<Result> => {
      const url = new URL(`${normalizedBaseUrl}${path}`);
      addQuery(url, options.query);
      const headers = new Headers();
      if (token) {
        headers.set("authorization", `Bearer ${token}`);
      }
      if (options.body !== undefined) {
        headers.set("content-type", "application/json");
      }

      const response = await fetch(url, {
        method,
        headers,
        ...(options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) }),
      });
      if (!response.ok) {
        throw await apiError(response);
      }
      if (options.response === "void" || response.status === 204) {
        return undefined as Result;
      }
      if (options.response === "text") {
        return (await response.text()) as Result;
      }
      return (await response.json()) as Result;
    },
  };
};

const addQuery = (
  url: URL,
  query: Readonly<Record<string, QueryValue>> | undefined,
) => {
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) {
      continue;
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      url.searchParams.append(key, String(item));
    }
  }
};

const apiError = async (response: Response): Promise<Error> => {
  let message = `${response.status} ${response.statusText}`;
  try {
    const body = (await response.json()) as { error?: string };
    if (body.error) {
      message = `${message}: ${body.error}`;
    }
  } catch {
    // Some API errors have no JSON body; status text remains useful.
  }
  return new Error(`GoodLinks API error: ${message}`);
};
