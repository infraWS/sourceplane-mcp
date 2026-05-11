import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Config } from "../src/config.js";

import {
  getSourceStructure,
  listSourceFiles,
  readSourceFile,
  searchCode
} from "../src/sources.js";

function jsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => data,
    text: async () => JSON.stringify(data)
  } as Response;
}

function textResponse(data: string) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => JSON.parse(data),
    text: async () => data
  } as Response;
}

function notFoundResponse() {
  return {
    ok: false,
    status: 404,
    statusText: "Not Found",
    json: async () => ({}),
    text: async () => "Not Found"
  } as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GitLab provider", () => {
  const config: Config = {
    sources: {
      gitlab: {
        type: "gitlab",
        host: "https://gitlab.example.com",
        webUrl: "https://gitlab.example.com",
        projectId: "platform/backend-api",
        defaultBranch: "main",
        token: "gitlab-token"
      }
    }
  };

  it("reads a file using the GitLab raw file API", async () => {
    const fetchMock = vi.fn(async () => textResponse("export const x = 1;\n"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await readSourceFile(config, "gitlab", "src/index.ts");

    expect(result).toContain("export const x");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://gitlab.example.com/api/v4/projects/platform%2Fbackend-api/repository/files/src%2Findex.ts/raw?ref=main",
      {
        headers: {
          Authorization: "Bearer gitlab-token"
        }
      }
    );
  });

  it("lists files using the GitLab repository tree API", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse([
        {
          id: "1",
          name: "src",
          type: "tree",
          path: "src",
          mode: "040000"
        },
        {
          id: "2",
          name: "README.md",
          type: "blob",
          path: "README.md",
          mode: "100644"
        }
      ])
    );

    vi.stubGlobal("fetch", fetchMock);

    const result = await listSourceFiles(config, "gitlab", "");

    expect(result).toContain("📁 src");
    expect(result).toContain("📄 README.md");
    expect(fetchMock.mock.calls[0][0]).toContain(
      "/api/v4/projects/platform%2Fbackend-api/repository/tree?ref=main"
    );
  });

  it("gets recursive GitLab source structure", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse([
        {
          id: "1",
          name: "src",
          type: "tree",
          path: "src",
          mode: "040000"
        },
        {
          id: "2",
          name: "index.ts",
          type: "blob",
          path: "src/index.ts",
          mode: "100644"
        },
        {
          id: "3",
          name: ".env",
          type: "blob",
          path: ".env",
          mode: "100644"
        }
      ])
    );

    vi.stubGlobal("fetch", fetchMock);

    const result = await getSourceStructure(config, "gitlab", undefined, 100);

    expect(result).toContain("src/index.ts");
    expect(result).not.toContain(".env");
    expect(fetchMock.mock.calls[0][0]).toContain("recursive=true");
  });

  it("searches GitLab code using GitLab project search API", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse([
        {
          filename: "index.ts",
          path: "src/index.ts",
          ref: "main"
        }
      ])
    );

    vi.stubGlobal("fetch", fetchMock);

    const result = await searchCode(config, "gitlab", "loadConfig", 10);

    expect(result).toContain("src/index.ts");
    expect(fetchMock.mock.calls[0][0]).toContain(
      "/api/v4/projects/platform%2Fbackend-api/search?scope=blobs&search=loadConfig"
    );
  });

  it("surfaces GitLab HTTP errors", async () => {
    const fetchMock = vi.fn(async () => notFoundResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      readSourceFile(config, "gitlab", "missing.ts")
    ).rejects.toThrow(/HTTP 404 Not Found/);
  });
});

describe("Bitbucket Cloud provider", () => {
  const config: Config = {
    sources: {
      bitbucket: {
        type: "bitbucket",
        host: "https://api.bitbucket.org/2.0",
        webUrl: "https://bitbucket.org",
        workspace: "engineering",
        slug: "frontend-app",
        defaultBranch: "main",
        token: "bitbucket-token"
      }
    }
  };

  it("reads a file using the Bitbucket Cloud source API", async () => {
    const fetchMock = vi.fn(async () => textResponse("console.log('hello');\n"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await readSourceFile(config, "bitbucket", "src/index.ts");

    expect(result).toContain("console.log");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.bitbucket.org/2.0/repositories/engineering/frontend-app/src/main/src/index.ts",
      {
        headers: {
          Authorization: "Bearer bitbucket-token"
        }
      }
    );
  });

  it("lists Bitbucket Cloud directory contents", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        values: [
          {
            type: "commit_directory",
            path: "src"
          },
          {
            type: "commit_file",
            path: "README.md"
          },
          {
            type: "commit_directory",
            path: ".wrangler"
          }
        ]
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    const result = await listSourceFiles(config, "bitbucket", "");

    expect(result).toContain("📁 src");
    expect(result).toContain("📄 README.md");
    expect(result).not.toContain(".wrangler");
  });

  it("gets Bitbucket Cloud source structure by walking directories", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/src/main/")) {
        return jsonResponse({
          values: [
            {
              type: "commit_directory",
              path: "src"
            },
            {
              type: "commit_file",
              path: "README.md"
            }
          ]
        });
      }

      if (url.endsWith("/src/main/src")) {
        return jsonResponse({
          values: [
            {
              type: "commit_file",
              path: "src/index.ts"
            },
            {
              type: "commit_file",
              path: "src/app.ts"
            }
          ]
        });
      }

      return jsonResponse({ values: [] });
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await getSourceStructure(config, "bitbucket", undefined, 100);

    expect(result).toContain("README.md");
    expect(result).toContain("src/index.ts");
    expect(result).toContain("src/app.ts");
  });

  it("searches Bitbucket Cloud using tree-walk search", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/src/main/")) {
        return jsonResponse({
          values: [
            {
              type: "commit_file",
              path: "src/index.ts"
            },
            {
              type: "commit_file",
              path: "README.md"
            }
          ]
        });
      }

      if (url.endsWith("/src/main/src/index.ts")) {
        return textResponse("export const loadConfig = true;\n");
      }

      if (url.endsWith("/src/main/README.md")) {
        return textResponse("# Fixture\n");
      }

      return jsonResponse({ values: [] });
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await searchCode(config, "bitbucket", "loadConfig", 10);

    expect(result).toContain("src/index.ts");
    expect(result).not.toContain("README.md");
  });
});

describe("Bitbucket Data Center provider", () => {
  const config: Config = {
    sources: {
      bitbucketDc: {
        type: "bitbucket",
        host: "https://bitbucket.company.com/rest/api/1.0",
        webUrl: "https://bitbucket.company.com",
        projectKey: "PLATFORM",
        slug: "backend-api",
        defaultBranch: "main",
        token: "bitbucket-dc-token"
      }
    }
  };

  it("reads a file using Bitbucket Data Center raw API", async () => {
    const fetchMock = vi.fn(async () => textResponse("export const api = true;\n"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await readSourceFile(
      config,
      "bitbucketDc",
      "src/index.ts"
    );

    expect(result).toContain("api = true");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://bitbucket.company.com/rest/api/1.0/projects/PLATFORM/repos/backend-api/raw/src/index.ts?at=refs/heads/main",
      {
        headers: {
          Authorization: "Bearer bitbucket-dc-token"
        }
      }
    );
  });

  it("lists Bitbucket Data Center directory contents", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        children: {
          values: [
            {
              path: {
                toString: "src"
              },
              type: "DIRECTORY"
            },
            {
              path: {
                toString: "README.md"
              },
              type: "FILE"
            },
            {
              path: {
                toString: ".env"
              },
              type: "FILE"
            }
          ],
          isLastPage: true
        }
      })
    );

    vi.stubGlobal("fetch", fetchMock);

    const result = await listSourceFiles(config, "bitbucketDc", "");

    expect(result).toContain("📁 src");
    expect(result).toContain("📄 README.md");
    expect(result).not.toContain(".env");
  });

  it("gets Bitbucket Data Center source structure by walking directories", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/browse/?")) {
        return jsonResponse({
          children: {
            values: [
              {
                path: {
                  toString: "src"
                },
                type: "DIRECTORY"
              },
              {
                path: {
                  toString: "README.md"
                },
                type: "FILE"
              }
            ],
            isLastPage: true
          }
        });
      }

      if (url.includes("/browse/src?")) {
        return jsonResponse({
          children: {
            values: [
              {
                path: {
                  toString: "src/index.ts"
                },
                type: "FILE"
              }
            ],
            isLastPage: true
          }
        });
      }

      return jsonResponse({
        children: {
          values: [],
          isLastPage: true
        }
      });
    });

    vi.stubGlobal("fetch", fetchMock);

    const result = await getSourceStructure(
      config,
      "bitbucketDc",
      undefined,
      100
    );

    expect(result).toContain("README.md");
    expect(result).toContain("src/index.ts");
  });
});