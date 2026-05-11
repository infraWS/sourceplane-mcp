import { describe, expect, it } from "vitest";

import {
  assertSafeRelativePath,
  assertTextBuffer,
  canonicalizeRelativePath,
  DEFAULT_EXCLUDE_PATTERNS,
  isBlockedPath,
  normalizeRepoPath
} from "../src/safety.js";

describe("path normalization", () => {
  it("normalizes leading slashes only through normalizeRepoPath", () => {
    expect(normalizeRepoPath("/src/index.ts")).toBe("src/index.ts");
  });

  it("canonicalizes safe relative paths", () => {
    expect(canonicalizeRelativePath("src/index.ts")).toBe("src/index.ts");
  });
});

describe("unsafe path rejection", () => {
  it.each([
    "../package.json",
    "../../.ssh/id_rsa",
    "/etc/passwd",
    "src//index.ts",
    "src\\index.ts",
    "src/%2e%2e/package.json",
    "src/%2Findex.ts",
    "src/%5cindex.ts",
    "abc\0def"
  ])("rejects unsafe path: %s", (input) => {
    expect(() => assertSafeRelativePath(input)).toThrow();
  });
});

describe("default exclude patterns", () => {
  it.each([
    "node_modules",
    "node_modules/",
    "apps/worker/node_modules",
    "apps/worker/node_modules/",
    ".wrangler",
    ".wrangler/",
    "apps/worker/.wrangler",
    "apps/worker/.wrangler/",
    ".env",
    "apps/api/.env",
    "terraform.tfstate",
    "infra/terraform.tfstate",
    "secrets/config.json",
    "certs/private.pem",
    "keys/app.key",
    "db/local.sqlite"
  ])("blocks excluded path: %s", (input) => {
    expect(isBlockedPath(input, DEFAULT_EXCLUDE_PATTERNS)).toBe(true);
  });

  it.each([
    "src/index.ts",
    "README.md",
    "apps/worker/src/index.ts",
    "package.json"
  ])("allows normal source path: %s", (input) => {
    expect(isBlockedPath(input, DEFAULT_EXCLUDE_PATTERNS)).toBe(false);
  });
});

describe("binary detection", () => {
  it("allows normal text buffers", () => {
    const buffer = Buffer.from("hello world\nconst x = 1;\n", "utf8");

    expect(() => assertTextBuffer(buffer, "src/index.ts")).not.toThrow();
  });

  it("rejects buffers containing null bytes", () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]);

    expect(() => assertTextBuffer(buffer, "fixtures/blob")).toThrow(
      /binary file/i
    );
  });
});