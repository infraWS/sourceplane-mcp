import fs from "fs";
import path from "path";
import YAML from "yaml";
import { DEFAULT_EXCLUDE_PATTERNS } from "./safety.js";

export type SourceType =
  | "github"
  | "gitlab"
  | "bitbucket"
  | "local"
  | "network";

export type DefaultsConfig = {
  owner?: string;
  defaultBranch?: string;
  maxFileSizeKb?: number;
  maxFiles?: number;
  followSymlinks?: boolean;
  pathBlocklist?: string[];
};

export type LocalWriteConfig = {
  enabled?: boolean;
  allowOverwrite?: boolean;
  createDirs?: boolean;
};

export type GitHubSourceConfig = {
  type: "github";
  host?: string;
  webUrl?: string;
  owner?: string;
  name: string;
  defaultBranch?: string;
  token?: string;
  pathBlocklist?: string[];
};

export type GitLabSourceConfig = {
  type: "gitlab";
  host?: string;
  webUrl?: string;
  projectId: string | number;
  defaultBranch?: string;
  token?: string;
  pathBlocklist?: string[];
};

export type BitbucketSourceConfig = {
  type: "bitbucket";
  host?: string;
  webUrl?: string;
  workspace?: string;
  projectKey?: string;
  slug: string;
  defaultBranch?: string;
  token?: string;
  pathBlocklist?: string[];
};

export type FilesystemSourceConfig = {
  type: "local" | "network";
  path: string;
  pathBlocklist?: string[];
  maxFileSizeKb?: number;
  maxFiles?: number;
  followSymlinks?: boolean;
  write?: LocalWriteConfig;
};

export type SourceConfig =
  | GitHubSourceConfig
  | GitLabSourceConfig
  | BitbucketSourceConfig
  | FilesystemSourceConfig;

export type Config = {
  server?: {
    name?: string;
    version?: string;
  };
  defaults?: DefaultsConfig;
  sources: Record<string, SourceConfig>;
};

export type ResolvedGitHubSource = {
  type: "github";
  host: string;
  webUrl: string;
  owner: string;
  name: string;
  defaultBranch: string;
  token?: string;
  pathBlocklist: string[];
};

export type ResolvedGitLabSource = {
  type: "gitlab";
  host: string;
  webUrl: string;
  projectId: string | number;
  defaultBranch: string;
  token?: string;
  pathBlocklist: string[];
};

export type ResolvedBitbucketSource = {
  type: "bitbucket";
  host: string;
  webUrl: string;
  workspace?: string;
  projectKey?: string;
  slug: string;
  defaultBranch: string;
  token?: string;
  pathBlocklist: string[];
};

export type ResolvedFilesystemSource = {
  type: "local" | "network";
  rootPath: string;
  maxFileSizeKb: number;
  maxFiles: number;
  followSymlinks: boolean;
  pathBlocklist: string[];
  write: {
    enabled: boolean;
    allowOverwrite: boolean;
    createDirs: boolean;
  };
};

export type ResolvedSource =
  | ResolvedGitHubSource
  | ResolvedGitLabSource
  | ResolvedBitbucketSource
  | ResolvedFilesystemSource;

const DEFAULT_PROVIDER_HOSTS = {
  github: {
    host: "https://api.github.com",
    webUrl: "https://github.com"
  },
  gitlab: {
    host: "https://gitlab.com",
    webUrl: "https://gitlab.com"
  },
  bitbucket: {
    host: "https://api.bitbucket.org/2.0",
    webUrl: "https://bitbucket.org"
  }
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
    const resolved = process.env[envVar];

    if (!resolved) {
      throw new Error(`Missing environment variable: ${envVar}`);
    }

    return resolved;
  });
}

function expandHome(inputPath: string): string {
  if (inputPath === "~") {
    return process.env.HOME ?? inputPath;
  }

  if (inputPath.startsWith("~/")) {
    return path.join(process.env.HOME ?? "", inputPath.slice(2));
  }

  return inputPath;
}

export function loadConfig(configPath = "./config/sources.yaml"): Config {
  const rawConfig = fs.readFileSync(configPath, "utf8");
  const parsed = YAML.parse(rawConfig) as Config;

  const config = JSON.parse(JSON.stringify(parsed), (_, value) => {
    if (typeof value === "string") {
      return resolveEnvVars(value);
    }

    return value;
  }) as Config;

  if (!config.sources || Object.keys(config.sources).length === 0) {
    throw new Error(`No sources configured in ${configPath}`);
  }

  return config;
}

export function getSource(config: Config, sourceKey: string): ResolvedSource {
  const source = config.sources[sourceKey];

  if (!source) {
    throw new Error(`Unknown source key: ${sourceKey}`);
  }

  const defaults = config.defaults ?? {};

  const inheritedBlocklist = [
    ...DEFAULT_EXCLUDE_PATTERNS,
    ...(defaults.pathBlocklist ?? []),
    ...(source.pathBlocklist ?? [])
  ];

  if (source.type === "github") {
    const owner = source.owner ?? defaults.owner;

    if (!owner) {
      throw new Error(`Missing owner for GitHub source: ${sourceKey}`);
    }

    return {
      type: "github",
      host: trimTrailingSlash(source.host ?? DEFAULT_PROVIDER_HOSTS.github.host),
      webUrl: trimTrailingSlash(source.webUrl ?? DEFAULT_PROVIDER_HOSTS.github.webUrl),
      owner,
      name: source.name,
      defaultBranch: source.defaultBranch ?? defaults.defaultBranch ?? "main",
      token: source.token,
      pathBlocklist: inheritedBlocklist
    };
  }

  if (source.type === "gitlab") {
    return {
      type: "gitlab",
      host: trimTrailingSlash(source.host ?? DEFAULT_PROVIDER_HOSTS.gitlab.host),
      webUrl: trimTrailingSlash(source.webUrl ?? source.host ?? DEFAULT_PROVIDER_HOSTS.gitlab.webUrl),
      projectId: source.projectId,
      defaultBranch: source.defaultBranch ?? defaults.defaultBranch ?? "main",
      token: source.token,
      pathBlocklist: inheritedBlocklist
    };
  }

  if (source.type === "bitbucket") {
    if (!source.workspace && !source.projectKey) {
      throw new Error(
        `Bitbucket source ${sourceKey} requires either workspace or projectKey`
      );
    }

    return {
      type: "bitbucket",
      host: trimTrailingSlash(source.host ?? DEFAULT_PROVIDER_HOSTS.bitbucket.host),
      webUrl: trimTrailingSlash(source.webUrl ?? DEFAULT_PROVIDER_HOSTS.bitbucket.webUrl),
      workspace: source.workspace,
      projectKey: source.projectKey,
      slug: source.slug,
      defaultBranch: source.defaultBranch ?? defaults.defaultBranch ?? "main",
      token: source.token,
      pathBlocklist: inheritedBlocklist
    };
  }

  return {
    type: source.type,
    rootPath: path.resolve(expandHome(source.path)),
    maxFileSizeKb: source.maxFileSizeKb ?? defaults.maxFileSizeKb ?? 512,
    maxFiles: source.maxFiles ?? defaults.maxFiles ?? 1000,
    followSymlinks: source.followSymlinks ?? defaults.followSymlinks ?? false,
    pathBlocklist: inheritedBlocklist,
    write: {
      enabled: source.type === "local" ? source.write?.enabled ?? false : false,
      allowOverwrite: source.write?.allowOverwrite ?? false,
      createDirs: source.write?.createDirs ?? false
    }
  };
}