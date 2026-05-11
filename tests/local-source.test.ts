import os from "os";
import path from "path";
import fsp from "fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Config } from "../src/config.js";

import {
  getSourceStructure,
  listSourceFiles,
  readSourceFile,
  searchCode
} from "../src/sources.js";

let root: string;
let config: Config;

async function writeFile(filePath: string, content: string | Buffer) {
  const fullPath = path.join(root, filePath);
  await fsp.mkdir(path.dirname(fullPath), { recursive: true });
  await fsp.writeFile(fullPath, content);
}

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), "sourceplane-test-"));

  config = {
    defaults: {
      maxFileSizeKb: 512,
      maxFiles: 1000,
      followSymlinks: false
    },
    sources: {
      fixture: {
        type: "local",
        path: root
      }
    }
  };

  await writeFile("package.json", '{"name":"fixture"}\n');
  await writeFile("src/index.ts", "export const loadConfig = true;\n");
  await writeFile(
    "src/config.ts",
    "export function canonicalizeRelativePath() {}\n"
  );
  await writeFile("apps/worker/src/index.ts", "console.log('worker');\n");

  await fsp.mkdir(path.join(root, "apps/worker/.wrangler"), {
    recursive: true
  });

  await fsp.mkdir(path.join(root, "apps/worker/node_modules"), {
    recursive: true
  });

  await writeFile("fixtures/binaryblob", Buffer.from([0x89, 0x50, 0x00, 0x01]));
});

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe("local read_file", () => {
  it("reads normal text files", async () => {
    await expect(readSourceFile(config, "fixture", "package.json")).resolves.toContain(
      "fixture"
    );
  });

  it("rejects trailing slash on file paths", async () => {
    await expect(
      readSourceFile(config, "fixture", "apps/worker/src/index.ts/")
    ).rejects.toThrow(/Trailing slash on file path is not allowed/i);
  });

  it.each([
    "../package.json",
    "../../.ssh/id_rsa",
    "/etc/passwd",
    "src//index.ts",
    "src\\index.ts",
    "src/%2e%2e/package.json",
    "src/%2Findex.ts",
    "src/%5cindex.ts"
  ])("rejects unsafe path: %s", async (input) => {
    await expect(readSourceFile(config, "fixture", input)).rejects.toThrow();
  });

  it("sanitizes missing file errors", async () => {
    await expect(
      readSourceFile(config, "fixture", "does-not-exist.ts")
    ).rejects.toThrow("File not found: does-not-exist.ts");

    await expect(
      readSourceFile(config, "fixture", "does-not-exist.ts")
    ).rejects.not.toThrow(root);
  });

  it("rejects content-based binary files even without binary extension", async () => {
    await expect(
      readSourceFile(config, "fixture", "fixtures/binaryblob")
    ).rejects.toThrow(/binary file/i);
  });
});

describe("local list_files", () => {
  it("lists root files", async () => {
    const result = await listSourceFiles(config, "fixture", "");

    expect(result).toContain("package.json");
    expect(result).toContain("src");
  });

  it.each([
    "node_modules",
    "node_modules/",
    "apps/worker/node_modules",
    "apps/worker/node_modules/",
    ".wrangler",
    ".wrangler/",
    "apps/worker/.wrangler",
    "apps/worker/.wrangler/"
  ])("explicitly blocks excluded directories: %s", async (input) => {
    await expect(listSourceFiles(config, "fixture", input)).rejects.toThrow(
      /Path is blocked by configuration/i
    );
  });

  it("sanitizes missing directory errors", async () => {
    await expect(
      listSourceFiles(config, "fixture", "missing/dir")
    ).rejects.toThrow("Directory not found: missing/dir");

    await expect(
      listSourceFiles(config, "fixture", "missing/dir")
    ).rejects.not.toThrow(root);
  });
});

describe("local get_source_structure", () => {
  it("returns recursive structure and excludes blocked folders", async () => {
    const result = await getSourceStructure(config, "fixture", undefined, 100);

    expect(result).toContain("package.json");
    expect(result).toContain("src/index.ts");
    expect(result).not.toContain(".wrangler");
    expect(result).not.toContain("node_modules");
  });
});

describe("local search_code", () => {
  it("returns file path, line number, and snippet context", async () => {
    const result = await searchCode(config, "fixture", "loadConfig", 10);

    expect(result).toContain("src/index.ts:1");
    expect(result).toContain("loadConfig");
  });

  it("finds canonicalizeRelativePath", async () => {
    const result = await searchCode(
      config,
      "fixture",
      "canonicalizeRelativePath",
      10
    );

    expect(result).toContain("src/config.ts:1");
  });
});