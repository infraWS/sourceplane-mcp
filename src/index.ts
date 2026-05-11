import "dotenv/config";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loadConfig } from "./config.js";

import {
  getSourceStructure,
  listSourceFiles,
  listSources,
  readSourceFile,
  searchCode,
  writeSourceFile
} from "./sources.js";

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

const WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false
};

function text(value: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: value
      }
    ]
  };
}

export function createServer(configPath?: string) {
  const config = loadConfig(
    configPath ??
    process.env.SOURCEPLANE_CONFIG ??
    "./config/sources.yaml"
  );

  const server = new McpServer({
    name: config.server?.name ?? "sourceplane-mcp",
    version: config.server?.version ?? "1.0.0"
  });

  server.registerTool(
    "list_sources",
    {
      title: "List Sources",
      description: "List configured code sources",
      inputSchema: {},
      annotations: READ_ONLY_ANNOTATIONS
    },
    async () => {
      return text(listSources(config));
    }
  );

  server.registerTool(
    "read_file",
    {
      title: "Read File",
      description: "Read a file from a configured source",
      inputSchema: {
        sourceKey: z.string(),
        path: z.string(),
        branch: z.string().optional()
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    async ({ sourceKey, path, branch }) => {
      return text(
        await readSourceFile(
          config,
          sourceKey,
          path,
          branch
        )
      );
    }
  );

  server.registerTool(
    "read_files",
    {
      title: "Read Multiple Files",
      description: "Read multiple files from a configured source",
      inputSchema: {
        sourceKey: z.string(),
        paths: z.array(z.string()).min(1).max(20),
        branch: z.string().optional()
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    async ({ sourceKey, paths, branch }) => {
      const output: string[] = [];

      for (const filePath of paths) {
        try {
          const content = await readSourceFile(
            config,
            sourceKey,
            filePath,
            branch
          );

          output.push(`--- ${filePath} ---\n${content}`);
        } catch (error: any) {
          output.push(
            `--- ${filePath} ---\nERROR: ${error.message}`
          );
        }
      }

      return text(output.join("\n\n"));
    }
  );

  server.registerTool(
    "list_files",
    {
      title: "List Files",
      description: "List files in a source directory",
      inputSchema: {
        sourceKey: z.string(),
        path: z.string().optional(),
        branch: z.string().optional()
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    async ({ sourceKey, path = "", branch }) => {
      return text(
        await listSourceFiles(
          config,
          sourceKey,
          path,
          branch
        )
      );
    }
  );

  server.registerTool(
    "get_source_structure",
    {
      title: "Get Source Structure",
      description: "Get source file tree",
      inputSchema: {
        sourceKey: z.string(),
        branch: z.string().optional(),
        maxFiles: z.number().int().min(1).max(5000).optional()
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    async ({ sourceKey, branch, maxFiles }) => {
      return text(
        await getSourceStructure(
          config,
          sourceKey,
          branch,
          maxFiles
        )
      );
    }
  );

  server.registerTool(
    "search_code",
    {
      title: "Search Code",
      description: "Search code in a configured source",
      inputSchema: {
        sourceKey: z.string(),
        query: z.string(),
        branch: z.string().optional(),
        maxResults: z.number().int().min(1).max(50).optional()
      },
      annotations: READ_ONLY_ANNOTATIONS
    },
    async ({
      sourceKey,
      query,
      branch,
      maxResults = 20
    }) => {
      return text(
        await searchCode(
          config,
          sourceKey,
          query,
          maxResults,
          branch
        )
      );
    }
  );

  server.registerTool(
    "write_file",
    {
      title: "Write File",
      description:
        "Write a UTF-8 text file to a local source. Disabled by default and only available for local sources with write.enabled=true.",
      inputSchema: {
        sourceKey: z.string(),
        path: z.string(),
        content: z.string()
      },
      annotations: WRITE_ANNOTATIONS
    },
    async ({ sourceKey, path, content }) => {
      return text(
        await writeSourceFile(
          config,
          sourceKey,
          path,
          content
        )
      );
    }
  );

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer();

  const transport = new StdioServerTransport();

  await server.connect(transport);
}