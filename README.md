# Sourceplane MCP

![CI](https://img.shields.io/github/actions/workflow/status/infraWS/sourceplane-mcp/ci.yml?branch=main)
![Coverage](https://img.shields.io/badge/coverage-76%25-brightgreen)
![License](https://img.shields.io/github/license/infraWS/sourceplane-mcp)
![Node](https://img.shields.io/badge/node-%3E%3D20-blue)
![MCP](https://img.shields.io/badge/MCP-compatible-purple)

Secure multi-source MCP server for local repositories, GitHub, GitLab, Bitbucket, and mounted network workspaces.

Sourceplane MCP provides a consistent Model Context Protocol interface for safely exposing source code and documentation to MCP-compatible AI clients such as Claude Desktop.

The platform is read-only by default, with optional local-only development write support.

It is designed specifically for source context and repository inspection — not platform automation.

---

## Why Sourceplane MCP Exists

Modern engineering environments are fragmented across:

- frontend repositories
- backend services
- infrastructure repositories
- shared libraries
- monorepos
- local workspaces
- mounted NAS shares
- self-hosted Git providers
- documentation repositories

AI assistants are significantly more useful when they can safely inspect source trees directly instead of relying on manual copy/paste.

Sourceplane MCP focuses on:

- read-only-by-default access
- explicit source allowlisting
- filesystem safety
- secure defaults
- self-hosted provider support
- local-first workflows
- predictable behavior
- low operational complexity
- easy auditing

---

## Supported Sources

| Source Type | Description | Token Required |
|---|---|---|
| `github` | GitHub repository via API | Optional for public repos |
| `gitlab` | GitLab project via API | Optional for public projects |
| `bitbucket` | Bitbucket Cloud or Data Center repository | Optional for public repos |
| `local` | Local workspace folder | No |
| `network` | Mounted NAS or network share | No |

Network sources are mounted filesystem paths such as:

```text
/Volumes/Engineering/shared-platform
/mnt/shared/platform
```

They are not arbitrary internet URLs.

---

## Current Capability Matrix

| Capability | GitHub | GitLab | Bitbucket Cloud | Bitbucket Data Center | Local | Network |
|---|---:|---:|---:|---:|---:|---:|
| Public source without token | Yes | Yes | Yes | Usually internal only | N/A | N/A |
| Private source with token | Yes | Yes | Yes | Yes | N/A | N/A |
| Custom `host` | Yes | Yes | Yes | Yes | N/A | N/A |
| Custom `webUrl` | Yes | Yes | Yes | Yes | N/A | N/A |
| `list_sources` | Yes | Yes | Yes | Yes | Yes | Yes |
| `read_file` | Yes | Yes | Yes | Yes | Yes | Yes |
| `read_files` | Yes | Yes | Yes | Yes | Yes | Yes |
| `list_files` | Yes | Yes | Yes | Yes | Yes | Yes |
| `get_source_structure` | Yes | Yes | Yes | Yes | Yes | Yes |
| `search_code` | API search | API search / tree search | Tree-based search | Tree-based search | Local scan | Local scan |
| Branch override | Yes | Yes | Yes | Yes | No | No |
| Built-in blocklist | Yes | Yes | Yes | Yes | Yes | Yes |
| Source-specific blocklist | Yes | Yes | Yes | Yes | Yes | Yes |
| Write operations | No | No | No | No | Optional local-only | No |

---

## Available MCP Tools

| Tool | Description |
|---|---|
| `list_sources` | List configured sources |
| `read_file` | Read a single file |
| `read_files` | Read multiple files |
| `list_files` | List files in a directory |
| `get_source_structure` | Get recursive source tree |
| `search_code` | Search source code |
| `write_file` | Write a UTF-8 text file to an explicitly writable local source |

All tools use the same source-key model:

```json
{
  "sourceKey": "platform-api",
  "path": "src/index.ts"
}
```

---

## Installation

### Requirements

- Node.js 20+
- npm

Optional:
- Git provider tokens for private repositories

### Clone Repository

```bash
git clone https://github.com/infraWS/sourceplane-mcp.git

cd sourceplane-mcp
```

### Install Dependencies

```bash
npm install
```

### Build

```bash
npm run build
```

---

## Configuration

Copy the example configuration:

```bash
cp config/sources.example.yaml config/sources.yaml
```

`config/sources.yaml` is intentionally gitignored.

---

## Example Configuration

```yaml
server:
  name: sourceplane-mcp
  version: 1.0.0

defaults:
  owner: my-org
  defaultBranch: main

  maxFileSizeKb: 512
  maxFiles: 1000

  followSymlinks: false

  pathBlocklist:
    - .env
    - .env.*
    - secrets/
    - certificates/
    - private/
    - "*.pem"
    - "*.key"
    - "*.p12"
    - terraform.tfstate
    - terraform.tfstate.*
    - "*.tfvars"

sources:

  github-public:
    type: github
    owner: nodejs
    name: node

  github-private:
    type: github
    name: terraform-platform
    token: ${GITHUB_TOKEN}

  github-enterprise:
    type: github
    host: https://github.company.com/api/v3
    webUrl: https://github.company.com

    owner: platform
    name: terraform-platform

    token: ${GITHUB_ENTERPRISE_TOKEN}

  gitlab-public:
    type: gitlab
    projectId: gitlab-org/gitlab

  gitlab-private:
    type: gitlab
    projectId: platform/backend-api
    token: ${GITLAB_TOKEN}

  gitlab-self-managed:
    type: gitlab
    host: https://gitlab.company.com
    webUrl: https://gitlab.company.com

    projectId: platform/backend-api

    token: ${GITLAB_SELF_MANAGED_TOKEN}

  bitbucket-cloud:
    type: bitbucket
    workspace: engineering
    slug: frontend-app

    token: ${BITBUCKET_TOKEN}

  bitbucket-datacenter:
    type: bitbucket
    host: https://bitbucket.company.com/rest/api/1.0
    webUrl: https://bitbucket.company.com

    projectKey: PLATFORM
    slug: frontend-app

    token: ${BITBUCKET_DC_TOKEN}

  local-api:
    type: local
    path: ~/Projects/api-service

    write:
      enabled: false
      allowOverwrite: false
      createDirs: false

  shared-network:
    type: network
    path: /Volumes/Engineering/shared-platform
```

---

## Local Development Write Support

Sourceplane MCP is read-only by default.

Local filesystem sources can explicitly opt into controlled write access for development workflows.

Write support is:

- disabled by default
- available only for `local` sources
- not supported for Git providers
- not supported for network sources
- protected by the same path safety and blocklist rules as read operations

Supported operations:

- UTF-8 text file writes
- optional overwrites
- optional parent directory creation

Unsupported operations:

- file deletion
- renames
- shell execution
- binary writes
- permission modification

### Example Writable Local Source

```yaml
sources:

  local-dev:
    type: local
    path: ~/Projects/my-app

    write:
      enabled: true
      allowOverwrite: true
      createDirs: true
```

### Example `write_file`

```json
{
  "sourceKey": "local-dev",
  "path": "src/generated/example.ts",
  "content": "export const example = true;\n"
}
```
---

## Security Model

Sourceplane MCP is intentionally restrictive.

It does not:

- write files outside explicitly writable local sources
- create commits
- open pull requests
- merge pull requests
- execute shell commands
- trigger CI/CD workflows
- access arbitrary repositories
- access arbitrary filesystem paths
- expose provider secrets
- modify repositories

Only explicitly configured sources are accessible.

Even when write support is enabled for local sources, writes remain constrained to the configured source root and continue to enforce:

- traversal protection
- blocklist enforcement
- binary detection
- path normalization
- UTF-8 text-only writes

---

## Built-in Security Protections

### Path Validation

The server rejects:

- parent traversal (`../`)
- absolute paths (`/etc/passwd`)
- double slashes (`//`)
- Windows backslashes (`\`)
- URL-encoded traversal attempts (`%2e`, `%2f`, `%5c`)
- null-byte injection attempts

### Built-in Blocklist

The server always applies an internal protection layer.

Examples include:

- `.git/`
- `.wrangler/`
- `node_modules/`
- `.env`
- Terraform state files
- SSH folders
- certificates
- private keys
- generated artifacts

Blocklists are merged in this order:

```text
DEFAULT_PATH_BLOCKLIST
→ defaults.pathBlocklist
→ source.pathBlocklist
```

### Binary File Protection

The server refuses to read binary files using:

- extension-based filtering
- content-based binary detection

### Filesystem Isolation

Local and network sources are constrained to their configured root path.

Example rejected request:

```json
{
  "sourceKey": "local-api",
  "path": "../../.ssh/id_rsa"
}
```

Symlinks are disabled by default:

```yaml
defaults:
  followSymlinks: false
```

---

## Claude Desktop Setup

macOS Claude Desktop configuration path:

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

Example:

```json
{
  "mcpServers": {
    "sourceplane-mcp": {
      "command": "node",
      "args": [
        "/absolute/path/to/sourceplane-mcp/dist/index.js"
      ],
      "env": {
        "SOURCEPLANE_CONFIG": "/absolute/path/to/sourceplane-mcp/config/sources.yaml",
        "GITHUB_TOKEN": "github_pat_xxx",
        "GITLAB_TOKEN": "glpat_xxx",
        "BITBUCKET_TOKEN": "xxx"
      }
    }
  }
}
```

Restart Claude Desktop after updating the configuration.

---

## Automated Testing

Sourceplane MCP includes automated tests covering:

- traversal rejection
- nested blocklist enforcement
- filesystem isolation
- sanitized error handling
- binary detection
- provider URL construction
- GitLab provider behavior
- Bitbucket Cloud behavior
- Bitbucket Data Center behavior
- local source scanning

Current coverage includes:

- high coverage for security-critical logic
- mocked provider API tests
- CI validation on Node.js 20 and 22

Run tests:

```bash
npm run test
npm run coverage
```

---

## Scripts

```bash
npm run dev
npm run build
npm run start
npm run clean
npm run test
npm run coverage
```

---

## Design Principles

Sourceplane MCP favors:

- explicit configuration
- least privilege
- read-only-by-default access
- secure defaults
- predictable behavior
- local-first workflows
- self-hosted provider support
- easy auditing

It is intentionally narrower in scope than platform-automation MCP servers.

---

## License

MIT License