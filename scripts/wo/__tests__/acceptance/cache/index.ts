import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const FIXTURES_DIR = path.join(__dirname, "..", "fixtures");
const NO_CACHE = process.argv.includes("--no-cache") || process.env.NO_CACHE === "true";

/**
 * Initialize cache directory structure.
 * If --no-cache flag is set, clears all existing fixtures.
 */
export const initializeCache = () => {
  if (NO_CACHE) {
    console.log("[cache] --no-cache mode: clearing fixtures");
    clearCache();
  }
  ensureCacheDirectories();
};

/**
 * Check if we're in no-cache mode (hitting real backends).
 */
export const isNoCache = () => NO_CACHE;

/**
 * Clear all cached fixtures.
 */
export const clearCache = () => {
  const subdirs = ["trello", "gh"];
  for (const subdir of subdirs) {
    const dir = path.join(FIXTURES_DIR, subdir);
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        fs.unlinkSync(path.join(dir, file));
      }
    }
  }
};

/**
 * Ensure cache directories exist.
 */
export const ensureCacheDirectories = () => {
  const subdirs = ["trello", "gh"];
  for (const subdir of subdirs) {
    const dir = path.join(FIXTURES_DIR, subdir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
};

/**
 * Generate a cache key from request details.
 * Includes relevant env vars for uniqueness.
 */
export const generateCacheKey = (
  type: "trello" | "gh",
  method: string,
  url: string,
  body?: string,
): string => {
  const envVars: Record<string, string | undefined> = {
    GH_HOST: process.env.GH_HOST,
    TRELLO_BOARD_ID_WO: process.env.TRELLO_BOARD_ID_WO,
  };

  const keyData = JSON.stringify({ method, url, body, env: envVars });
  const hash = crypto.createHash("sha256").update(keyData).digest("hex").slice(0, 16);

  // Create a readable prefix from the URL
  const urlPath = url.replace(/https?:\/\/[^/]+/, "").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 50);
  return `${method}_${urlPath}_${hash}`;
};

/**
 * Get the file path for a cached response.
 */
export const getCachePath = (type: "trello" | "gh", cacheKey: string): string => {
  return path.join(FIXTURES_DIR, type, `${cacheKey}.json`);
};

/**
 * Check if a cached response exists.
 */
export const hasCachedResponse = (type: "trello" | "gh", cacheKey: string): boolean => {
  if (NO_CACHE) return false;
  return fs.existsSync(getCachePath(type, cacheKey));
};

/**
 * Read a cached response.
 */
export const readCachedResponse = <T>(type: "trello" | "gh", cacheKey: string): T | null => {
  const cachePath = getCachePath(type, cacheKey);
  if (!fs.existsSync(cachePath)) return null;

  try {
    const content = fs.readFileSync(cachePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
};

/**
 * Write a response to cache.
 */
export const writeCachedResponse = <T>(type: "trello" | "gh", cacheKey: string, response: T): void => {
  const cachePath = getCachePath(type, cacheKey);
  fs.writeFileSync(cachePath, JSON.stringify(response, null, 2));
};
