#!/usr/bin/env npx tsx
/**
 * GitHub Copilot GHE Authentication Script
 *
 * Manages OAuth device flow and session token refresh for GitHub Copilot
 * on GitHub Enterprise Cloud instances.
 *
 * Usage:
 *   npx tsx scripts/copilot-ghe-auth.ts [command]
 *
 * Commands:
 *   login     - Full OAuth device code flow (interactive)
 *   refresh   - Refresh session token using stored OAuth token
 *   status    - Check current token status and expiry
 *   help      - Show this help message
 *
 * Environment:
 *   GHE_HOST  - GitHub Enterprise host (default: schibsted.ghe.com)
 */

import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

// Configuration
const GHE_HOST = process.env.GHE_HOST ?? "schibsted.ghe.com";
const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";
const AUTH_FILE = join(homedir(), ".local/share/opencode/auth.json");
const OAUTH_CACHE_FILE = join(homedir(), ".local/share/opencode/copilot-ghe-oauth.json");
const PROVIDER_NAME = "copilot-ghe";

// API endpoints
const DEVICE_CODE_URL = `https://${GHE_HOST}/login/device/code`;
const ACCESS_TOKEN_URL = `https://${GHE_HOST}/login/oauth/access_token`;
const SESSION_TOKEN_URL = `https://api.${GHE_HOST}/copilot_internal/v2/token`;

type AuthJson = {
  [provider: string]: {
    type: string;
    key: string;
  };
};

type OAuthCache = {
  access_token: string;
  token_type: string;
  github_host: string;
  obtained_at: number;
};

type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
};

type AccessTokenResponse = {
  access_token?: string;
  token_type?: string;
  scope?: string;
  github_host?: string;
  error?: string;
  error_description?: string;
};

type SessionTokenResponse = {
  token: string;
  expires_at: number;
};

async function readAuthJson(): Promise<AuthJson> {
  try {
    const content = await readFile(AUTH_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

async function writeAuthJson(auth: AuthJson): Promise<void> {
  await writeFile(AUTH_FILE, JSON.stringify(auth, null, 2) + "\n");
}

async function readOAuthCache(): Promise<OAuthCache | null> {
  try {
    const content = await readFile(OAUTH_CACHE_FILE, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function writeOAuthCache(cache: OAuthCache): Promise<void> {
  await writeFile(OAUTH_CACHE_FILE, JSON.stringify(cache, null, 2) + "\n");
}

async function startDeviceCodeFlow(): Promise<DeviceCodeResponse> {
  const response = await fetch(DEVICE_CODE_URL, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: COPILOT_CLIENT_ID,
      scope: "copilot",
    }),
  });

  if (!response.ok) {
    throw new Error(`Device code request failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function pollForAccessToken(deviceCode: string, interval: number): Promise<AccessTokenResponse> {
  const pollInterval = Math.max(interval, 5) * 1000;

  while (true) {
    await new Promise((resolve) => setTimeout(resolve, pollInterval));

    const response = await fetch(ACCESS_TOKEN_URL, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: COPILOT_CLIENT_ID,
        device_code: deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
    });

    const data: AccessTokenResponse = await response.json();

    if (data.access_token) {
      return data;
    }

    if (data.error === "authorization_pending") {
      process.stdout.write(".");
      continue;
    }

    if (data.error === "slow_down") {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      continue;
    }

    if (data.error === "expired_token") {
      throw new Error("Device code expired. Please restart the login flow.");
    }

    if (data.error) {
      throw new Error(`OAuth error: ${data.error} - ${data.error_description}`);
    }
  }
}

async function getSessionToken(oauthToken: string): Promise<SessionTokenResponse> {
  const response = await fetch(SESSION_TOKEN_URL, {
    headers: {
      "Authorization": `token ${oauthToken}`,
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Session token request failed: ${response.status} - ${text}`);
  }

  return response.json();
}

function parseSessionToken(token: string): { exp?: number; [key: string]: unknown } {
  const parts: Record<string, string> = {};
  for (const part of token.split(";")) {
    const [key, ...rest] = part.split("=");
    if (key && rest.length > 0) {
      parts[key] = rest.join("=");
    }
  }
  return {
    ...parts,
    exp: parts.exp ? parseInt(parts.exp, 10) : undefined,
  };
}

function formatExpiry(timestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = timestamp - now;

  if (diff <= 0) {
    return "EXPIRED";
  }

  const minutes = Math.floor(diff / 60);
  const seconds = diff % 60;

  if (minutes > 0) {
    return `${minutes}m ${seconds}s remaining`;
  }
  return `${seconds}s remaining`;
}

async function promptUser(question: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function commandLogin(): Promise<void> {
  console.log(`Starting GitHub Copilot OAuth flow for ${GHE_HOST}...\n`);

  // Step 1: Get device code
  const deviceCode = await startDeviceCodeFlow();

  console.log("=".repeat(50));
  console.log("AUTHORIZATION REQUIRED");
  console.log("=".repeat(50));
  console.log("");
  console.log(`1. Open: https://${GHE_HOST}/login/device`);
  console.log(`2. Enter code: ${deviceCode.user_code}`);
  console.log("3. Authorize the GitHub Copilot application");
  console.log("");
  console.log("=".repeat(50));
  console.log("");

  await promptUser("Press Enter after authorizing...");

  console.log("\nPolling for authorization");

  // Step 2: Poll for access token
  const accessToken = await pollForAccessToken(deviceCode.device_code, deviceCode.interval);
  console.log("\n\nOAuth token obtained!");

  // Cache the OAuth token for future refreshes
  await writeOAuthCache({
    access_token: accessToken.access_token!,
    token_type: accessToken.token_type ?? "bearer",
    github_host: accessToken.github_host ?? GHE_HOST,
    obtained_at: Date.now(),
  });
  console.log("OAuth token cached for future refreshes.");

  // Step 3: Exchange for session token
  console.log("\nExchanging for Copilot session token...");
  const sessionToken = await getSessionToken(accessToken.access_token!);

  // Step 4: Update auth.json
  const auth = await readAuthJson();
  auth[PROVIDER_NAME] = {
    type: "api",
    key: sessionToken.token,
  };
  await writeAuthJson(auth);

  console.log("\nAuthentication complete!");
  console.log(`Session token expires: ${formatExpiry(sessionToken.expires_at)}`);
  console.log(`\nStored in: ${AUTH_FILE}`);
}

async function commandRefresh(): Promise<void> {
  console.log("Refreshing Copilot session token...\n");

  // Read cached OAuth token
  const cache = await readOAuthCache();
  if (!cache) {
    console.error("No cached OAuth token found. Run 'login' first.");
    process.exit(1);
  }

  console.log(`Using cached OAuth token (obtained ${new Date(cache.obtained_at).toLocaleString()})`);

  try {
    // Get new session token
    const sessionToken = await getSessionToken(cache.access_token);

    // Update auth.json
    const auth = await readAuthJson();
    auth[PROVIDER_NAME] = {
      type: "api",
      key: sessionToken.token,
    };
    await writeAuthJson(auth);

    console.log("\nSession token refreshed!");
    console.log(`Expires: ${formatExpiry(sessionToken.expires_at)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("401") || message.includes("403")) {
      console.error("\nOAuth token expired or revoked. Run 'login' to re-authenticate.");
      process.exit(1);
    }
    throw error;
  }
}

async function commandStatus(): Promise<void> {
  console.log("Copilot GHE Authentication Status\n");
  console.log(`Host: ${GHE_HOST}`);
  console.log(`Provider: ${PROVIDER_NAME}`);
  console.log("");

  // Check OAuth cache
  const cache = await readOAuthCache();
  if (cache) {
    console.log("OAuth Token: Cached");
    console.log(`  Obtained: ${new Date(cache.obtained_at).toLocaleString()}`);
  } else {
    console.log("OAuth Token: Not cached (run 'login' first)");
  }
  console.log("");

  // Check current session token
  const auth = await readAuthJson();
  const providerAuth = auth[PROVIDER_NAME];

  if (!providerAuth) {
    console.log("Session Token: Not configured");
    return;
  }

  const parsed = parseSessionToken(providerAuth.key);

  if (parsed.exp) {
    const now = Math.floor(Date.now() / 1000);
    const isExpired = parsed.exp <= now;

    console.log(`Session Token: ${isExpired ? "EXPIRED" : "Valid"}`);
    console.log(`  Expires: ${new Date(parsed.exp * 1000).toLocaleString()}`);
    console.log(`  Status: ${formatExpiry(parsed.exp)}`);

    if (parsed.sku) {
      console.log(`  SKU: ${parsed.sku}`);
    }
    if (parsed.chat) {
      console.log(`  Chat enabled: ${parsed.chat === "1" ? "Yes" : "No"}`);
    }
    if (parsed.agent_mode) {
      console.log(`  Agent mode: ${parsed.agent_mode === "1" ? "Yes" : "No"}`);
    }
  } else {
    console.log("Session Token: Present (unable to parse expiry)");
  }
}

function printHelp(): void {
  console.log(`
GitHub Copilot GHE Authentication

Usage: npx tsx scripts/copilot-ghe-auth.ts [command]

Commands:
  login     Full OAuth device code flow (interactive)
            - Opens browser authorization
            - Caches OAuth token for future refreshes
            - Obtains session token

  refresh   Refresh session token using cached OAuth token
            - Quick refresh without browser interaction
            - Requires previous 'login'

  status    Check current token status
            - Shows OAuth and session token state
            - Displays expiry information

  help      Show this help message

Environment Variables:
  GHE_HOST  GitHub Enterprise host (default: ${GHE_HOST})

Files:
  ${AUTH_FILE}
    OpenCode authentication store

  ${OAUTH_CACHE_FILE}
    Cached OAuth token for refreshes

Notes:
  - Session tokens expire in ~25 minutes
  - OAuth tokens may last longer but can be revoked
  - Run 'refresh' periodically or when token expires
  - Run 'login' if OAuth token is revoked
`);
}

// Main entry point
const command = process.argv[2] ?? "help";

switch (command) {
  case "login":
    commandLogin().catch((error) => {
      console.error("Login failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    });
    break;
  case "refresh":
    commandRefresh().catch((error) => {
      console.error("Refresh failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    });
    break;
  case "status":
    commandStatus().catch((error) => {
      console.error("Status check failed:", error instanceof Error ? error.message : error);
      process.exit(1);
    });
    break;
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
