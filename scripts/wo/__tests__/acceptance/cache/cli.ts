import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  isNoCache,
  ensureCacheDirectories,
} from "./index";

const execFileAsync = promisify(execFile);

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures", "gh");

type CachedCliResponse = {
  stdout: string;
  exitCode: number;
};

// Commands to cache (read-only operations)
const CACHEABLE_COMMANDS = new Set(["gh"]);
const CACHEABLE_GH_SUBCOMMANDS = new Set(["pr", "issue", "api", "project"]);

/**
 * Generate cache key for CLI command.
 * Includes relevant env vars for uniqueness.
 */
const generateCliCacheKey = (command: string, args: string[], cwd?: string): string => {
  const envVars: Record<string, string | undefined> = {
    GH_HOST: process.env.GH_HOST,
  };

  const keyData = JSON.stringify({ command, args, cwd, env: envVars });
  const hash = crypto.createHash("sha256").update(keyData).digest("hex").slice(0, 16);

  // Create readable prefix from command and first few args
  const prefix = [command, ...args.slice(0, 3)]
    .join("_")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .slice(0, 50);
  return `${prefix}_${hash}`;
};

/**
 * Check if a command should be cached.
 */
const shouldCache = (command: string, args: string[]): boolean => {
  if (!CACHEABLE_COMMANDS.has(command)) return false;
  if (command === "gh" && args.length > 0) {
    return CACHEABLE_GH_SUBCOMMANDS.has(args[0]);
  }
  return false;
};

/**
 * Get cached response if available.
 */
const getCachedResponse = (cacheKey: string): CachedCliResponse | null => {
  if (isNoCache()) return null;

  const cachePath = path.join(FIXTURES_DIR, `${cacheKey}.json`);
  if (!fs.existsSync(cachePath)) return null;

  try {
    const content = fs.readFileSync(cachePath, "utf-8");
    return JSON.parse(content) as CachedCliResponse;
  } catch {
    return null;
  }
};

/**
 * Save response to cache.
 */
const saveCachedResponse = (cacheKey: string, response: CachedCliResponse): void => {
  ensureCacheDirectories();
  const cachePath = path.join(FIXTURES_DIR, `${cacheKey}.json`);
  fs.writeFileSync(cachePath, JSON.stringify(response, null, 2));
};

/**
 * Cached version of runCommandCapture.
 * For gh commands: uses cache (VCR-style).
 * For other commands: runs directly.
 */
export const cachedRunCommandCapture = async (
  command: string,
  args: string[],
  options: { cwd?: string } = {},
): Promise<string> => {
  const cacheKey = generateCliCacheKey(command, args, options.cwd);

  // Check if this command should be cached
  if (shouldCache(command, args)) {
    // Check cache first
    const cached = getCachedResponse(cacheKey);
    if (cached) {
      console.log(`[cli-cache] HIT: ${command} ${args.slice(0, 3).join(" ")}...`);
      if (cached.exitCode !== 0) {
        const error = new Error(`${command} exited with status ${cached.exitCode}`) as Error & { code: number };
        error.code = cached.exitCode;
        throw error;
      }
      return cached.stdout;
    }

    console.log(`[cli-cache] MISS: ${command} ${args.slice(0, 3).join(" ")}...`);
  }

  // Cache miss or non-cacheable: run real command
  try {
    const { stdout } = await execFileAsync(command, args, {
      cwd: options.cwd,
      maxBuffer: 1024 * 1024 * 10,
      env: { ...process.env },
    });

    // Cache successful response for cacheable commands
    if (shouldCache(command, args)) {
      saveCachedResponse(cacheKey, { stdout, exitCode: 0 });
    }

    return stdout;
  } catch (error) {
    // Cache failed response too (to replay failures consistently)
    if (shouldCache(command, args)) {
      const exitCode = (error as { code?: number }).code ?? 1;
      saveCachedResponse(cacheKey, { stdout: "", exitCode });
    }
    throw error;
  }
};

/**
 * Track calls to runCommand for verification in tests.
 */
export const runCommandCalls: Array<{
  command: string;
  args: string[];
  options?: { cwd?: string; dryRun?: boolean; verbose?: boolean; allowFailure?: boolean };
}> = [];

/**
 * Mock runCommand that tracks calls but doesn't execute.
 * Side-effecting commands (gwq, tmux, git worktree) are not executed in tests.
 */
export const mockRunCommand = async (
  command: string,
  args: string[],
  options: { cwd?: string; dryRun?: boolean; verbose?: boolean; allowFailure?: boolean } = {},
): Promise<void> => {
  runCommandCalls.push({ command, args, options });

  if (options.verbose) {
    console.log(`[cli-mock] ${command} ${args.join(" ")}`);
  }

  // Don't actually execute - these are side-effecting commands
};

/**
 * Reset CLI tracking between tests.
 */
export const resetCliCache = () => {
  runCommandCalls.length = 0;
};

/**
 * Get recorded runCommand calls for assertions.
 */
export const getRunCommandCalls = () => [...runCommandCalls];
