export const DEFAULT_PATH_BLOCKLIST = [
  ".git/",
  ".svn/",
  ".hg/",

  "node_modules/",
  "vendor/",
  ".venv/",
  "venv/",
  "__pycache__/",

  "dist/",
  "build/",
  "out/",
  "target/",
  "coverage/",
  ".next/",
  ".nuxt/",
  ".turbo/",
  ".cache/",

  ".wrangler/",
  ".dev.vars",
  ".mf/",

  ".env",
  ".env.*",
  "*.env",

  "secrets/",
  "secret/",
  "certificates/",
  "certs/",
  "private/",

  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "*.crt",
  "*.cer",
  "*.jks",
  "*.keystore",

  ".terraform/",
  "terraform.tfstate",
  "terraform.tfstate.*",
  "*.tfvars",
  "*.tfvars.json",

  ".ssh/",
  ".aws/",
  ".azure/",
  ".gcloud/",

  "credentials",
  "credentials.json",
  "service-account.json",

  ".DS_Store",
  "Thumbs.db",

  ".idea/",
  ".vscode/"
];

export const DEFAULT_BINARY_BLOCKLIST = [
  "*.zip",
  "*.tar",
  "*.gz",
  "*.tgz",
  "*.bz2",
  "*.xz",
  "*.7z",
  "*.rar",

  "*.png",
  "*.jpg",
  "*.jpeg",
  "*.gif",
  "*.webp",
  "*.ico",
  "*.bmp",
  "*.tiff",
  "*.svgz",

  "*.mp4",
  "*.mov",
  "*.avi",
  "*.mkv",
  "*.webm",

  "*.mp3",
  "*.wav",
  "*.flac",
  "*.aac",
  "*.ogg",

  "*.pdf",

  "*.doc",
  "*.docx",

  "*.ppt",
  "*.pptx",

  "*.xls",
  "*.xlsx",

  "*.exe",
  "*.dll",
  "*.so",
  "*.dylib",
  "*.bin",
  "*.app",
  "*.dmg",
  "*.iso",

  "*.jar",
  "*.war",
  "*.ear",
  "*.class",

  "*.pyc",
  "*.pyo",

  "*.woff",
  "*.woff2",
  "*.ttf",
  "*.otf",
  "*.eot",

  "*.sqlite",
  "*.sqlite3",
  "*.db",
  "*.db-shm",
  "*.db-wal",

  "*.lockb",
  "bun.lockb"
];

export const DEFAULT_EXCLUDE_PATTERNS = [
  ...DEFAULT_PATH_BLOCKLIST,
  ...DEFAULT_BINARY_BLOCKLIST
];

export function normalizeRepoPath(inputPath: string): string {
  return inputPath.replace(/^\/+/, "");
}

export function assertSafeRelativePath(inputPath: string): void {
  if (inputPath.includes("\0")) {
    throw new Error(`Null bytes are not allowed in paths`);
  }

  if (inputPath.includes("\\")) {
    throw new Error(
      `Backslashes are not allowed in paths: ${inputPath}`
    );
  }

  if (
    /%2e/i.test(inputPath) ||
    /%2f/i.test(inputPath) ||
    /%5c/i.test(inputPath)
  ) {
    throw new Error(
      `URL-encoded path traversal characters are not allowed: ${inputPath}`
    );
  }

  if (inputPath.startsWith("/")) {
    throw new Error(
      `Absolute paths are not allowed: ${inputPath}`
    );
  }

  if (inputPath.includes("//")) {
    throw new Error(
      `Consecutive slashes are not allowed: ${inputPath}`
    );
  }

  const parts = inputPath.split("/");

  if (parts.includes("..")) {
    throw new Error(
      `Parent directory traversal is not allowed: ${inputPath}`
    );
  }
}

export function canonicalizeRelativePath(
  inputPath: string
): string {
  assertSafeRelativePath(inputPath);

  return normalizeRepoPath(inputPath);
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");

  return new RegExp(`^${escaped}$`, "i");
}

export function isBlockedPath(
  inputPath: string,
  blocklist: string[]
): boolean {
  const normalized = normalizeRepoPath(inputPath)
    .replace(/\/+$/, "")
    .toLowerCase();

  const segments = normalized
    .split("/")
    .filter(Boolean);

  return blocklist.some((pattern) => {
    const lowerPattern = pattern.toLowerCase();

    if (pattern.endsWith("/")) {
      const folder = lowerPattern.replace(/\/+$/, "");

      return segments.includes(folder);
    }

    if (pattern.startsWith("*.")) {
      return normalized.endsWith(
        lowerPattern.slice(1)
      );
    }

    if (pattern.includes("*")) {
      return segments.some((segment) =>
        globToRegExp(lowerPattern).test(segment)
      );
    }

    return (
      normalized === lowerPattern ||
      normalized.endsWith(`/${lowerPattern}`) ||
      segments.includes(lowerPattern)
    );
  });
}

export function looksBinary(buffer: Buffer): boolean {
  const sampleSize = Math.min(buffer.length, 8000);

  if (sampleSize === 0) {
    return false;
  }

  if (
    buffer
      .subarray(0, sampleSize)
      .includes(0)
  ) {
    return true;
  }

  let suspiciousBytes = 0;

  for (let i = 0; i < sampleSize; i++) {
    const byte = buffer[i];

    if (
      byte < 7 ||
      (byte > 14 && byte < 32)
    ) {
      suspiciousBytes++;
    }
  }

  return (
    suspiciousBytes / sampleSize > 0.3
  );
}

export function assertTextBuffer(
  buffer: Buffer,
  filePath: string
): void {
  if (looksBinary(buffer)) {
    throw new Error(
      `Refusing to read binary file: ${filePath}`
    );
  }
}