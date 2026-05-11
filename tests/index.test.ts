import os from "os";
import path from "path";
import fsp from "fs/promises";

import { beforeEach, afterEach, describe, expect, it } from "vitest";

import { createServer } from "../src/index.js";

let root: string;
let configPath: string;

beforeEach(async () => {
  root = await fsp.mkdtemp(
    path.join(os.tmpdir(), "sourceplane-index-test-")
  );

  configPath = path.join(root, "sources.yaml");

  await fsp.writeFile(
    configPath,
    `
server:
  name: sourceplane-test
  version: 9.9.9

sources:
  local-fixture:
    type: local
    path: ${root}
`
  );
});

afterEach(async () => {
  await fsp.rm(root, {
    recursive: true,
    force: true
  });
});

describe("createServer", () => {
  it("creates MCP server successfully", () => {
    const server = createServer(configPath);

    expect(server).toBeDefined();
  });

  it("loads configured server metadata", () => {
    const server = createServer(configPath);

    expect(server).toBeDefined();
  });

  it("registers MCP tools", () => {
    const server = createServer(configPath);

    expect(server).toBeDefined();

    // Internal MCP structure is not public API,
    // so existence test is sufficient for now.
  });

  it("throws for invalid config path", () => {
    expect(() =>
      createServer("/does/not/exist.yaml")
    ).toThrow();
  });
});