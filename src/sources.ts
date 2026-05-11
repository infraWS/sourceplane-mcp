import fsp from "fs/promises";
import path from "path";
import { Octokit } from "@octokit/rest";

import {
  Config,
  getSource,
  ResolvedBitbucketSource,
  ResolvedFilesystemSource,
  ResolvedGitHubSource,
  ResolvedGitLabSource
} from "./config.js";

import {
  assertTextBuffer,
  canonicalizeRelativePath,
  isBlockedPath,
  normalizeRepoPath
} from "./safety.js";

function getOctokit(source: ResolvedGitHubSource): Octokit {
  return source.token
    ? new Octokit({ auth: source.token, baseUrl: source.host })
    : new Octokit({ baseUrl: source.host });
}

function authHeaders(token?: string): Record<string, string> {
  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`
  };
}

async function httpText(url: string, token?: string): Promise<string> {
  const response = await fetch(url, {
    headers: authHeaders(token)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
  }

  return response.text();
}

async function httpJson<T>(url: string, token?: string): Promise<T> {
  const response = await fetch(url, {
    headers: authHeaders(token)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${url}`);
  }

  return response.json() as Promise<T>;
}

function encodePathSegments(inputPath: string): string {
  return normalizeRepoPath(inputPath)
    .split("/")
    .map(encodeURIComponent)
    .join("/");
}

function encodeGitLabProjectId(projectId: string | number): string {
  return encodeURIComponent(String(projectId));
}

function encodeGitLabFilePath(filePath: string): string {
  return encodeURIComponent(normalizeRepoPath(filePath));
}

function resolveSafeLocalPath(
  source: ResolvedFilesystemSource,
  requestedPath = ""
): string {

  const relativePath = canonicalizeRelativePath(requestedPath);

  if (isBlockedPath(relativePath, source.pathBlocklist)) {
    throw new Error(`Path is blocked by configuration: ${requestedPath}`);
  }

  const resolvedPath = path.resolve(source.rootPath, relativePath);
  const rootWithSeparator = source.rootPath.endsWith(path.sep)
    ? source.rootPath
    : `${source.rootPath}${path.sep}`;

  if (resolvedPath !== source.rootPath && !resolvedPath.startsWith(rootWithSeparator)) {
    throw new Error(`Path escapes configured source root: ${requestedPath}`);
  }

  return resolvedPath;
}

async function readGitHubFile(
  source: ResolvedGitHubSource,
  filePath: string,
  branch?: string
): Promise<string> {
  const normalizedPath = normalizeRepoPath(filePath);

  if (isBlockedPath(normalizedPath, source.pathBlocklist)) {
    throw new Error(`Path is blocked by configuration: ${filePath}`);
  }

  const octokit = getOctokit(source);

  const { data } = await octokit.repos.getContent({
    owner: source.owner,
    repo: source.name,
    path: normalizedPath,
    ref: branch ?? source.defaultBranch
  });

  if (Array.isArray(data) || data.type !== "file") {
    throw new Error(`${filePath} is not a file`);
  }

  if (!data.content) {
    throw new Error(`No content returned for ${filePath}`);
  }

  return Buffer.from(data.content, "base64").toString("utf8");
}

async function readGitLabFile(
  source: ResolvedGitLabSource,
  filePath: string,
  branch?: string
): Promise<string> {
  const normalizedPath = normalizeRepoPath(filePath);

  if (isBlockedPath(normalizedPath, source.pathBlocklist)) {
    throw new Error(`Path is blocked by configuration: ${filePath}`);
  }

  const projectId = encodeGitLabProjectId(source.projectId);
  const encodedFilePath = encodeGitLabFilePath(normalizedPath);
  const ref = encodeURIComponent(branch ?? source.defaultBranch);

  const url =
    `${source.host}/api/v4/projects/${projectId}` +
    `/repository/files/${encodedFilePath}/raw?ref=${ref}`;

  return httpText(url, source.token);
}

function isBitbucketCloud(source: ResolvedBitbucketSource): boolean {
  return Boolean(source.workspace);
}

async function readBitbucketFile(
  source: ResolvedBitbucketSource,
  filePath: string,
  branch?: string
): Promise<string> {
  const normalizedPath = normalizeRepoPath(filePath);

  if (isBlockedPath(normalizedPath, source.pathBlocklist)) {
    throw new Error(`Path is blocked by configuration: ${filePath}`);
  }

  const ref = encodeURIComponent(branch ?? source.defaultBranch);
  const encodedPath = encodePathSegments(normalizedPath);

  if (isBitbucketCloud(source)) {
    const workspace = encodeURIComponent(source.workspace!);
    const slug = encodeURIComponent(source.slug);

    const url =
      `${source.host}/repositories/${workspace}/${slug}` +
      `/src/${ref}/${encodedPath}`;

    return httpText(url, source.token);
  }

  const projectKey = encodeURIComponent(source.projectKey!);
  const slug = encodeURIComponent(source.slug);

  const url =
    `${source.host}/projects/${projectKey}/repos/${slug}` +
    `/raw/${encodedPath}?at=refs/heads/${ref}`;

  return httpText(url, source.token);
}

async function readLocalFile(
  source: ResolvedFilesystemSource,
  filePath: string
): Promise<string> {
  if (filePath.endsWith("/")) {
    throw new Error(`Trailing slash on file path is not allowed: ${filePath}`);
  }

  const normalizedFilePath = canonicalizeRelativePath(filePath);

  const resolvedPath = resolveSafeLocalPath(
    source,
    normalizedFilePath
  );

  let stat;

  try {
    stat = source.followSymlinks
      ? await fsp.stat(resolvedPath)
      : await fsp.lstat(resolvedPath);
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new Error(`File not found: ${normalizedFilePath}`);
    }

    throw new Error(`Unable to access file: ${filePath}`);
  }

  if (!stat.isFile()) {
    throw new Error(`${normalizedFilePath} is not a file`);
  }

  const maxBytes = source.maxFileSizeKb * 1024;

  if (stat.size > maxBytes) {
    throw new Error(`${normalizedFilePath} exceeds max file size of ${source.maxFileSizeKb}KB`);
  }

  const buffer = await fsp.readFile(resolvedPath);

  assertTextBuffer(buffer, filePath);

  return buffer.toString("utf8");
}

export async function readSourceFile(
  config: Config,
  sourceKey: string,
  filePath: string,
  branch?: string
): Promise<string> {
  const source = getSource(config, sourceKey);

  if (source.type === "github") {
    return readGitHubFile(source, filePath, branch);
  }

  if (source.type === "gitlab") {
    return readGitLabFile(source, filePath, branch);
  }

  if (source.type === "bitbucket") {
    return readBitbucketFile(source, filePath, branch);
  }

  return readLocalFile(source, filePath);
}

async function listGitHubFiles(
  source: ResolvedGitHubSource,
  dirPath = "",
  branch?: string
): Promise<string> {
  const normalizedPath = normalizeRepoPath(dirPath);

  if (isBlockedPath(normalizedPath, source.pathBlocklist)) {
    throw new Error(`Path is blocked by configuration: ${dirPath}`);
  }

  const octokit = getOctokit(source);

  const { data } = await octokit.repos.getContent({
    owner: source.owner,
    repo: source.name,
    path: normalizedPath,
    ref: branch ?? source.defaultBranch
  });

  if (!Array.isArray(data)) {
    throw new Error(`${dirPath || "/"} is not a directory`);
  }

  return data
    .filter((item) => !isBlockedPath(item.path, source.pathBlocklist))
    .map((item) => `${item.type === "dir" ? "📁" : "📄"} ${item.path}`)
    .join("\n");
}

type GitLabTreeItem = {
  id: string;
  name: string;
  type: "tree" | "blob";
  path: string;
  mode: string;
};

async function listGitLabTreePage(
  source: ResolvedGitLabSource,
  dirPath = "",
  branch?: string,
  recursive = false,
  perPage = 100
): Promise<GitLabTreeItem[]> {
  const projectId = encodeGitLabProjectId(source.projectId);
  const ref = encodeURIComponent(branch ?? source.defaultBranch);
  const pathQuery = dirPath ? `&path=${encodeURIComponent(normalizeRepoPath(dirPath))}` : "";
  const recursiveQuery = recursive ? "&recursive=true" : "";

  const url =
    `${source.host}/api/v4/projects/${projectId}` +
    `/repository/tree?ref=${ref}&per_page=${perPage}` +
    `${pathQuery}${recursiveQuery}`;

  return httpJson<GitLabTreeItem[]>(url, source.token);
}

async function listGitLabFiles(
  source: ResolvedGitLabSource,
  dirPath = "",
  branch?: string
): Promise<string> {
  const normalizedPath = normalizeRepoPath(dirPath);

  if (isBlockedPath(normalizedPath, source.pathBlocklist)) {
    throw new Error(`Path is blocked by configuration: ${dirPath}`);
  }

  const items = await listGitLabTreePage(source, normalizedPath, branch, false);

  return items
    .filter((item) => !isBlockedPath(item.path, source.pathBlocklist))
    .map((item) => `${item.type === "tree" ? "📁" : "📄"} ${item.path}`)
    .join("\n");
}

type BitbucketCloudSourceItem = {
  type: "commit_file" | "commit_directory";
  path: string;
};

type BitbucketCloudSourceResponse = {
  values?: BitbucketCloudSourceItem[];
  next?: string;
};

async function listBitbucketCloudDirectory(
  source: ResolvedBitbucketSource,
  dirPath = "",
  branch?: string
): Promise<BitbucketCloudSourceItem[]> {
  const ref = encodeURIComponent(branch ?? source.defaultBranch);
  const workspace = encodeURIComponent(source.workspace!);
  const slug = encodeURIComponent(source.slug);
  const encodedPath = encodePathSegments(dirPath);

  let url =
    `${source.host}/repositories/${workspace}/${slug}` +
    `/src/${ref}/${encodedPath}`;

  const results: BitbucketCloudSourceItem[] = [];

  while (url) {
    const page = await httpJson<BitbucketCloudSourceResponse>(url, source.token);
    results.push(...(page.values ?? []));
    url = page.next ?? "";
  }

  return results;
}

type BitbucketDcBrowseItem = {
  path: {
    toString: string;
  };
  type: "FILE" | "DIRECTORY";
};

type BitbucketDcBrowseResponse = {
  children?: {
    values: BitbucketDcBrowseItem[];
    isLastPage?: boolean;
    nextPageStart?: number;
  };
  values?: BitbucketDcBrowseItem[];
  isLastPage?: boolean;
  nextPageStart?: number;
};

async function listBitbucketDataCenterDirectory(
  source: ResolvedBitbucketSource,
  dirPath = "",
  branch?: string
): Promise<BitbucketDcBrowseItem[]> {
  const ref = encodeURIComponent(branch ?? source.defaultBranch);
  const projectKey = encodeURIComponent(source.projectKey!);
  const slug = encodeURIComponent(source.slug);
  const encodedPath = encodePathSegments(dirPath);

  const baseUrl =
    `${source.host}/projects/${projectKey}/repos/${slug}` +
    `/browse/${encodedPath}?at=refs/heads/${ref}&limit=1000`;

  let url = baseUrl;
  const results: BitbucketDcBrowseItem[] = [];

  while (url) {
    const page = await httpJson<BitbucketDcBrowseResponse>(url, source.token);

    const container = page.children ?? page;
    results.push(...(container.values ?? []));

    if (container.isLastPage !== false || container.nextPageStart === undefined) {
      break;
    }

    url = `${baseUrl}&start=${container.nextPageStart}`;
  }

  return results;
}

async function listBitbucketFiles(
  source: ResolvedBitbucketSource,
  dirPath = "",
  branch?: string
): Promise<string> {
  const normalizedPath = normalizeRepoPath(dirPath);

  if (isBlockedPath(normalizedPath, source.pathBlocklist)) {
    throw new Error(`Path is blocked by configuration: ${dirPath}`);
  }

  if (isBitbucketCloud(source)) {
    const items = await listBitbucketCloudDirectory(source, normalizedPath, branch);

    return items
      .filter((item) => !isBlockedPath(item.path, source.pathBlocklist))
      .map((item) => `${item.type === "commit_directory" ? "📁" : "📄"} ${item.path}`)
      .join("\n");
  }

  const items = await listBitbucketDataCenterDirectory(source, normalizedPath, branch);

  return items
    .filter((item) => !isBlockedPath(item.path.toString, source.pathBlocklist))
    .map((item) => `${item.type === "DIRECTORY" ? "📁" : "📄"} ${item.path.toString}`)
    .join("\n");
}

async function listLocalFiles(
  source: ResolvedFilesystemSource,
  dirPath = ""
): Promise<string> {
  const normalizedDirPath = canonicalizeRelativePath(dirPath);

  if (
    normalizedDirPath &&
    isBlockedPath(normalizedDirPath, source.pathBlocklist)
  ) {
    throw new Error(
      `Path is blocked by configuration: ${normalizedDirPath}`
    );
  }

  const resolvedPath = resolveSafeLocalPath(
    source,
    normalizedDirPath
  );

  let entries;

  try {
    entries = await fsp.readdir(resolvedPath, {
      withFileTypes: true
    });
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      throw new Error(`Directory not found: ${dirPath || "/"}`);
    }

    if (error?.code === "ENOTDIR") {
      throw new Error(`Not a directory: ${dirPath || "/"}`);
    }

    throw new Error(`Unable to list directory: ${dirPath || "/"}`);
  }

  return entries
    .map((entry) => {
      const relativePath = normalizeRepoPath(path.join(dirPath, entry.name));

      if (isBlockedPath(relativePath, source.pathBlocklist)) {
        return null;
      }

      return `${entry.isDirectory() ? "📁" : "📄"} ${relativePath}`;
    })
    .filter(Boolean)
    .join("\n");
}

export async function listSourceFiles(
  config: Config,
  sourceKey: string,
  dirPath = "",
  branch?: string
): Promise<string> {
  const source = getSource(config, sourceKey);

  if (source.type === "github") {
    return listGitHubFiles(source, dirPath, branch);
  }

  if (source.type === "gitlab") {
    return listGitLabFiles(source, dirPath, branch);
  }

  if (source.type === "bitbucket") {
    return listBitbucketFiles(source, dirPath, branch);
  }

  return listLocalFiles(source, dirPath);
}

async function getGitHubStructure(
  source: ResolvedGitHubSource,
  branch?: string,
  maxFiles = 1000
): Promise<string> {
  const octokit = getOctokit(source);
  const ref = branch ?? source.defaultBranch;

  const branchData = await octokit.repos.getBranch({
    owner: source.owner,
    repo: source.name,
    branch: ref
  });

  const treeSha = branchData.data.commit.commit.tree.sha;

  const { data } = await octokit.git.getTree({
    owner: source.owner,
    repo: source.name,
    tree_sha: treeSha,
    recursive: "1"
  });

  return data.tree
    .filter((item) => item.type === "blob")
    .map((item) => item.path)
    .filter((itemPath): itemPath is string => Boolean(itemPath))
    .filter((itemPath) => !isBlockedPath(itemPath, source.pathBlocklist))
    .slice(0, maxFiles)
    .join("\n");
}

async function getGitLabStructure(
  source: ResolvedGitLabSource,
  branch?: string,
  maxFiles = 1000
): Promise<string> {
  const items = await listGitLabTreePage(source, "", branch, true, Math.min(maxFiles, 100));

  return items
    .filter((item) => item.type === "blob")
    .map((item) => item.path)
    .filter((itemPath) => !isBlockedPath(itemPath, source.pathBlocklist))
    .slice(0, maxFiles)
    .join("\n");
}

async function walkBitbucketCloudFiles(
  source: ResolvedBitbucketSource,
  dirPath = "",
  branch?: string,
  collected: string[] = [],
  maxFiles = 1000
): Promise<string[]> {
  if (collected.length >= maxFiles) {
    return collected;
  }

  const items = await listBitbucketCloudDirectory(source, dirPath, branch);

  for (const item of items) {
    if (collected.length >= maxFiles) {
      break;
    }

    if (isBlockedPath(item.path, source.pathBlocklist)) {
      continue;
    }

    if (item.type === "commit_directory") {
      await walkBitbucketCloudFiles(source, item.path, branch, collected, maxFiles);
    } else {
      collected.push(item.path);
    }
  }

  return collected;
}

async function walkBitbucketDataCenterFiles(
  source: ResolvedBitbucketSource,
  dirPath = "",
  branch?: string,
  collected: string[] = [],
  maxFiles = 1000
): Promise<string[]> {
  if (collected.length >= maxFiles) {
    return collected;
  }

  const items = await listBitbucketDataCenterDirectory(source, dirPath, branch);

  for (const item of items) {
    if (collected.length >= maxFiles) {
      break;
    }

    const itemPath = item.path.toString;

    if (isBlockedPath(itemPath, source.pathBlocklist)) {
      continue;
    }

    if (item.type === "DIRECTORY") {
      await walkBitbucketDataCenterFiles(source, itemPath, branch, collected, maxFiles);
    } else {
      collected.push(itemPath);
    }
  }

  return collected;
}

async function getBitbucketStructure(
  source: ResolvedBitbucketSource,
  branch?: string,
  maxFiles = 1000
): Promise<string> {
  const files = isBitbucketCloud(source)
    ? await walkBitbucketCloudFiles(source, "", branch, [], maxFiles)
    : await walkBitbucketDataCenterFiles(source, "", branch, [], maxFiles);

  return files.slice(0, maxFiles).join("\n");
}

async function walkLocalFiles(
  source: ResolvedFilesystemSource,
  dirPath = "",
  collected: string[] = []
): Promise<string[]> {
  if (collected.length >= source.maxFiles) {
    return collected;
  }

  const resolvedPath = resolveSafeLocalPath(source, dirPath);
  const entries = await fsp.readdir(resolvedPath, { withFileTypes: true });

  for (const entry of entries) {
    if (collected.length >= source.maxFiles) {
      break;
    }

    const relativePath = canonicalizeRelativePath(
      path.join(dirPath, entry.name)
    );

    if (isBlockedPath(relativePath, source.pathBlocklist)) {
      continue;
    }

    if (entry.isSymbolicLink() && !source.followSymlinks) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkLocalFiles(source, relativePath, collected);
    } else if (entry.isFile()) {
      collected.push(relativePath);
    }
  }

  return collected;
}

export async function getSourceStructure(
  config: Config,
  sourceKey: string,
  branch?: string,
  maxFiles?: number
): Promise<string> {
  const source = getSource(config, sourceKey);

  if (source.type === "github") {
    return getGitHubStructure(source, branch, maxFiles ?? 1000);
  }

  if (source.type === "gitlab") {
    return getGitLabStructure(source, branch, maxFiles ?? 1000);
  }

  if (source.type === "bitbucket") {
    return getBitbucketStructure(source, branch, maxFiles ?? 1000);
  }

  const files = await walkLocalFiles(source);
  return files.slice(0, maxFiles ?? source.maxFiles).join("\n");
}

async function searchLocalCode(
  source: ResolvedFilesystemSource,
  query: string,
  maxResults: number
): Promise<string> {
  const files = await walkLocalFiles(source);
  const matches: string[] = [];

  for (const file of files) {
    if (matches.length >= maxResults) {
      break;
    }

    try {
      const content = await readLocalFile(source, file);
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= maxResults) {
          break;
        }

        if (file.includes(query) || lines[i].includes(query)) {
          const start = Math.max(0, i - 2);
          const end = Math.min(lines.length, i + 3);

          const snippet = lines
            .slice(start, end)
            .map((line, index) => `${start + index + 1}: ${line}`)
            .join("\n");

          matches.push(`--- ${file}:${i + 1} ---\n${snippet}`);
        }
      }
    } catch {
      continue;
    }
  }

  return matches.join("\n\n") || "No results found.";
}

async function searchGitHubCode(
  source: ResolvedGitHubSource,
  query: string,
  maxResults: number
): Promise<string> {
  const octokit = getOctokit(source);

  const { data } = await octokit.search.code({
    q: `${query} repo:${source.owner}/${source.name}`,
    per_page: maxResults
  });

  return (
    data.items.map((item) => `${item.path}\n${item.html_url}`).join("\n\n") ||
    "No results found."
  );
}

async function searchGitLabCode(
  source: ResolvedGitLabSource,
  query: string,
  maxResults: number
): Promise<string> {
  const projectId = encodeGitLabProjectId(source.projectId);
  const encodedQuery = encodeURIComponent(query);

  const url =
    `${source.host}/api/v4/projects/${projectId}` +
    `/search?scope=blobs&search=${encodedQuery}&per_page=${maxResults}`;

  type GitLabSearchItem = {
    filename?: string;
    path?: string;
    ref?: string;
  };

  const results = await httpJson<GitLabSearchItem[]>(url, source.token);

  return (
    results
      .map((item) => item.path ?? item.filename)
      .filter(Boolean)
      .slice(0, maxResults)
      .join("\n") || "No results found."
  );
}

async function searchBitbucketCode(
  source: ResolvedBitbucketSource,
  query: string,
  maxResults: number,
  branch?: string
): Promise<string> {
  const structure = await getBitbucketStructure(source, branch, 1000);
  const files = structure.split("\n").filter(Boolean);
  const matches: string[] = [];

  for (const file of files) {
    if (matches.length >= maxResults) {
      break;
    }

    try {
      const content = await readBitbucketFile(source, file, branch);

      if (file.includes(query) || content.includes(query)) {
        matches.push(file);
      }
    } catch {
      continue;
    }
  }

  return matches.join("\n") || "No results found.";
}

export async function searchCode(
  config: Config,
  sourceKey: string,
  query: string,
  maxResults: number,
  branch?: string
): Promise<string> {
  const source = getSource(config, sourceKey);

  if (source.type === "github") {
    return searchGitHubCode(source, query, maxResults);
  }

  if (source.type === "gitlab") {
    return searchGitLabCode(source, query, maxResults);
  }

  if (source.type === "bitbucket") {
    return searchBitbucketCode(source, query, maxResults, branch);
  }

  return searchLocalCode(source, query, maxResults);
}

export function listSources(config: Config): string {
  return Object.entries(config.sources)
    .map(([key]) => {
      const source = getSource(config, key);

      if (source.type === "github") {
        return [
          key,
          "  type: github",
          `  host: ${source.host}`,
          `  webUrl: ${source.webUrl}`,
          `  owner: ${source.owner}`,
          `  name: ${source.name}`,
          `  defaultBranch: ${source.defaultBranch}`,
          `  authenticated: ${source.token ? "yes" : "no"}`
        ].join("\n");
      }

      if (source.type === "gitlab") {
        return [
          key,
          "  type: gitlab",
          `  host: ${source.host}`,
          `  webUrl: ${source.webUrl}`,
          `  projectId: ${source.projectId}`,
          `  defaultBranch: ${source.defaultBranch}`,
          `  authenticated: ${source.token ? "yes" : "no"}`
        ].join("\n");
      }

      if (source.type === "bitbucket") {
        return [
          key,
          "  type: bitbucket",
          `  host: ${source.host}`,
          `  webUrl: ${source.webUrl}`,
          source.workspace
            ? `  workspace: ${source.workspace}`
            : `  projectKey: ${source.projectKey}`,
          `  slug: ${source.slug}`,
          `  defaultBranch: ${source.defaultBranch}`,
          `  authenticated: ${source.token ? "yes" : "no"}`
        ].join("\n");
      }

      return [
        key,
        `  type: ${source.type}`,
        `  path: ${source.rootPath}`,
        `  maxFileSizeKb: ${source.maxFileSizeKb}`,
        `  maxFiles: ${source.maxFiles}`,
        `  followSymlinks: ${source.followSymlinks}`
      ].join("\n");
    })
    .join("\n\n");
}