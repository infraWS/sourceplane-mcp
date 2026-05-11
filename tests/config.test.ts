import os from "os";
import path from "path";
import fsp from "fs/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSource, loadConfig } from "../src/config.js";

let root: string;

async function writeConfig(content: string): Promise<string> {
  const configPath = path.join(root, "sources.yaml");
  await fsp.writeFile(configPath, content);
  return configPath;
}

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), "sourceplane-config-test-"));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await fsp.rm(root, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("loads YAML config", async () => {
    const configPath = await writeConfig(`
server:
  name: sourceplane-mcp
  version: 1.0.0

sources:
  local-fixture:
    type: local
    path: ${root}
`);

    const config = loadConfig(configPath);

    expect(config.server?.name).toBe("sourceplane-mcp");
    expect(config.sources["local-fixture"].type).toBe("local");
  });

  it("interpolates environment variables", async () => {
    vi.stubEnv("GITHUB_TOKEN", "test-token");

    const configPath = await writeConfig(`
sources:
  github-fixture:
    type: github
    owner: my-org
    name: my-repo
    token: \${GITHUB_TOKEN}
`);

    const config = loadConfig(configPath);
    const source = getSource(config, "github-fixture");

    expect(source.type).toBe("github");

    if (source.type === "github") {
      expect(source.token).toBe("test-token");
    }
  });

  it("throws when an interpolated environment variable is missing", async () => {
    const configPath = await writeConfig(`
sources:
  github-fixture:
    type: github
    owner: my-org
    name: my-repo
    token: \${MISSING_TOKEN}
`);

    expect(() => loadConfig(configPath)).toThrow(
      /Missing environment variable: MISSING_TOKEN/
    );
  });

  it("throws when no sources are configured", async () => {
    const configPath = await writeConfig(`
server:
  name: sourceplane-mcp
`);

    expect(() => loadConfig(configPath)).toThrow(/No sources configured/);
  });
});

describe("getSource defaults and overrides", () => {
  it("resolves local source defaults", async () => {
    const configPath = await writeConfig(`
defaults:
  maxFileSizeKb: 256
  maxFiles: 123
  followSymlinks: true

sources:
  local-fixture:
    type: local
    path: ${root}
`);

    const config = loadConfig(configPath);
    const source = getSource(config, "local-fixture");

    expect(source.type).toBe("local");

    if (source.type === "local") {
      expect(source.rootPath).toBe(path.resolve(root));
      expect(source.maxFileSizeKb).toBe(256);
      expect(source.maxFiles).toBe(123);
      expect(source.followSymlinks).toBe(true);
    }
  });

  it("allows local source overrides over defaults", async () => {
    const configPath = await writeConfig(`
defaults:
  maxFileSizeKb: 256
  maxFiles: 123
  followSymlinks: false

sources:
  local-fixture:
    type: local
    path: ${root}
    maxFileSizeKb: 32
    maxFiles: 10
    followSymlinks: true
`);

    const config = loadConfig(configPath);
    const source = getSource(config, "local-fixture");

    expect(source.type).toBe("local");

    if (source.type === "local") {
      expect(source.maxFileSizeKb).toBe(32);
      expect(source.maxFiles).toBe(10);
      expect(source.followSymlinks).toBe(true);
    }
  });

  it("merges default and source path blocklists with built-in exclusions", async () => {
    const configPath = await writeConfig(`
defaults:
  pathBlocklist:
    - global-secret/

sources:
  local-fixture:
    type: local
    path: ${root}
    pathBlocklist:
      - source-secret/
`);

    const config = loadConfig(configPath);
    const source = getSource(config, "local-fixture");

    expect(source.type).toBe("local");

    if (source.type === "local") {
      expect(source.pathBlocklist).toContain(".git/");
      expect(source.pathBlocklist).toContain("global-secret/");
      expect(source.pathBlocklist).toContain("source-secret/");
    }
  });

  it("throws for unknown source keys", async () => {
    const configPath = await writeConfig(`
sources:
  local-fixture:
    type: local
    path: ${root}
`);

    const config = loadConfig(configPath);

    expect(() => getSource(config, "missing")).toThrow(
      /Unknown source key: missing/
    );
  });
});

describe("GitHub source resolution", () => {
  it("uses default GitHub SaaS host and webUrl", async () => {
    const configPath = await writeConfig(`
defaults:
  owner: my-org
  defaultBranch: main

sources:
  github-fixture:
    type: github
    name: my-repo
`);

    const config = loadConfig(configPath);
    const source = getSource(config, "github-fixture");

    expect(source.type).toBe("github");

    if (source.type === "github") {
      expect(source.host).toBe("https://api.github.com");
      expect(source.webUrl).toBe("https://github.com");
      expect(source.owner).toBe("my-org");
      expect(source.name).toBe("my-repo");
      expect(source.defaultBranch).toBe("main");
    }
  });

  it("allows GitHub Enterprise host and webUrl overrides", async () => {
    const configPath = await writeConfig(`
sources:
  github-enterprise:
    type: github
    host: https://github.company.com/api/v3/
    webUrl: https://github.company.com/
    owner: platform
    name: terraform-platform
    defaultBranch: develop
`);

    const config = loadConfig(configPath);
    const source = getSource(config, "github-enterprise");

    expect(source.type).toBe("github");

    if (source.type === "github") {
      expect(source.host).toBe("https://github.company.com/api/v3");
      expect(source.webUrl).toBe("https://github.company.com");
      expect(source.owner).toBe("platform");
      expect(source.defaultBranch).toBe("develop");
    }
  });

  it("throws when GitHub owner is missing", async () => {
    const configPath = await writeConfig(`
sources:
  github-fixture:
    type: github
    name: my-repo
`);

    const config = loadConfig(configPath);

    expect(() => getSource(config, "github-fixture")).toThrow(
      /Missing owner for GitHub source/
    );
  });
});

describe("GitLab source resolution", () => {
  it("uses default GitLab SaaS host and webUrl", async () => {
    const configPath = await writeConfig(`
defaults:
  defaultBranch: main

sources:
  gitlab-fixture:
    type: gitlab
    projectId: my-org/my-project
`);

    const config = loadConfig(configPath);
    const source = getSource(config, "gitlab-fixture");

    expect(source.type).toBe("gitlab");

    if (source.type === "gitlab") {
      expect(source.host).toBe("https://gitlab.com");
      expect(source.webUrl).toBe("https://gitlab.com");
      expect(source.projectId).toBe("my-org/my-project");
      expect(source.defaultBranch).toBe("main");
    }
  });

  it("allows GitLab self-managed host and webUrl overrides", async () => {
    const configPath = await writeConfig(`
sources:
  gitlab-self-managed:
    type: gitlab
    host: https://gitlab.company.com/
    webUrl: https://code.company.com/
    projectId: platform/backend-api
    defaultBranch: develop
`);

    const config = loadConfig(configPath);
    const source = getSource(config, "gitlab-self-managed");

    expect(source.type).toBe("gitlab");

    if (source.type === "gitlab") {
      expect(source.host).toBe("https://gitlab.company.com");
      expect(source.webUrl).toBe("https://code.company.com");
      expect(source.defaultBranch).toBe("develop");
    }
  });
});

describe("Bitbucket source resolution", () => {
  it("uses default Bitbucket Cloud host and webUrl", async () => {
    const configPath = await writeConfig(`
defaults:
  defaultBranch: main

sources:
  bitbucket-cloud:
    type: bitbucket
    workspace: engineering
    slug: frontend-app
`);

    const config = loadConfig(configPath);
    const source = getSource(config, "bitbucket-cloud");

    expect(source.type).toBe("bitbucket");

    if (source.type === "bitbucket") {
      expect(source.host).toBe("https://api.bitbucket.org/2.0");
      expect(source.webUrl).toBe("https://bitbucket.org");
      expect(source.workspace).toBe("engineering");
      expect(source.slug).toBe("frontend-app");
      expect(source.defaultBranch).toBe("main");
    }
  });

  it("allows Bitbucket Data Center host and webUrl overrides", async () => {
    const configPath = await writeConfig(`
sources:
  bitbucket-dc:
    type: bitbucket
    host: https://bitbucket.company.com/rest/api/1.0/
    webUrl: https://bitbucket.company.com/
    projectKey: PLATFORM
    slug: frontend-app
    defaultBranch: develop
`);

    const config = loadConfig(configPath);
    const source = getSource(config, "bitbucket-dc");

    expect(source.type).toBe("bitbucket");

    if (source.type === "bitbucket") {
      expect(source.host).toBe("https://bitbucket.company.com/rest/api/1.0");
      expect(source.webUrl).toBe("https://bitbucket.company.com");
      expect(source.projectKey).toBe("PLATFORM");
      expect(source.defaultBranch).toBe("develop");
    }
  });

  it("throws when Bitbucket source has neither workspace nor projectKey", async () => {
    const configPath = await writeConfig(`
sources:
  bitbucket-invalid:
    type: bitbucket
    slug: frontend-app
`);

    const config = loadConfig(configPath);

    expect(() => getSource(config, "bitbucket-invalid")).toThrow(
      /requires either workspace or projectKey/
    );
  });
});