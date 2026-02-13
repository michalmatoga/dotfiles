# GitHub Copilot GHE Authentication for OpenCode

This guide explains how to configure OpenCode to use GitHub Copilot with a GitHub Enterprise Cloud instance (e.g., `schibsted.ghe.com`).

## Overview

GitHub Copilot on GHE Cloud requires a two-step authentication process:

1. **OAuth Device Flow** - Authorize via browser to obtain an OAuth token (`ghu_...`)
2. **Session Token Exchange** - Exchange OAuth token for a short-lived session token (~25 min)

The session token is used by OpenCode to authenticate with the Copilot API.

## Quick Start

```bash
# Initial setup (interactive browser authorization)
npx tsx scripts/copilot-ghe-auth.ts login

# Check token status
npx tsx scripts/copilot-ghe-auth.ts status

# Refresh expired session token (no browser needed)
npx tsx scripts/copilot-ghe-auth.ts refresh
```

## Configuration

### Provider Configuration (`opencode.json`)

The provider is already configured in your `opencode.json`:

```json
{
  "provider": {
    "copilot-ghe": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "GitHub Copilot (GHE)",
      "options": {
        "baseURL": "https://copilot-api.schibsted.ghe.com",
        "headers": {
          "Editor-Version": "vscode/1.85.0",
          "Editor-Plugin-Version": "copilot-chat/0.12.0"
        }
      },
      "models": {
        "claude-opus-4.6": { "name": "Claude Opus 4.6 (Copilot)" },
        "gpt-5.2-codex": { "name": "GPT-5.2 Codex (Copilot)" },
        "gpt-4o": { "name": "GPT-4o (Copilot)" }
      }
    }
  }
}
```

### Key Configuration Points

| Setting | Value | Purpose |
|---------|-------|---------|
| `npm` | `@ai-sdk/openai-compatible` | Uses OpenAI-compatible SDK |
| `baseURL` | `https://copilot-api.schibsted.ghe.com` | Copilot API endpoint for GHE |
| `Editor-Version` | `vscode/1.85.0` | VS Code compatibility header |
| `Editor-Plugin-Version` | `copilot-chat/0.12.0` | Copilot plugin compatibility |

## Authentication Files

| File | Purpose |
|------|---------|
| `~/.local/share/opencode/auth.json` | OpenCode auth store (session token) |
| `~/.local/share/opencode/copilot-ghe-oauth.json` | Cached OAuth token for refreshes |

## Usage Workflow

### First-Time Setup

1. Run the login command:
   ```bash
   npx tsx scripts/copilot-ghe-auth.ts login
   ```

2. When prompted, open `https://schibsted.ghe.com/login/device` in your browser

3. Enter the displayed user code (e.g., `2E74-A764`)

4. Authorize the GitHub Copilot application

5. Press Enter in the terminal to complete authentication

### Daily Usage

Session tokens expire in ~25 minutes. When your token expires:

```bash
# Quick refresh using cached OAuth token
npx tsx scripts/copilot-ghe-auth.ts refresh
```

If the OAuth token has been revoked, run `login` again.

### Check Status

```bash
npx tsx scripts/copilot-ghe-auth.ts status
```

Shows:
- OAuth token cache status
- Session token validity
- Time until expiry
- Enabled features (chat, agent mode, etc.)

## Automatic Token Refresh (NixOS/home-manager)

A systemd user timer is configured in `etc/nixos/home.nix` to automatically refresh the token every 20 minutes.

After running `sudo nixos-rebuild switch`, the timer will be active:

```bash
# Check timer status
systemctl --user status copilot-ghe-refresh.timer

# View recent refresh logs
journalctl --user -u copilot-ghe-refresh -n 20

# Manually trigger a refresh
systemctl --user start copilot-ghe-refresh.service

# List all user timers
systemctl --user list-timers
```

**Important**: The timer requires a cached OAuth token. Run `login` at least once before the timer can refresh tokens automatically.

## Using Copilot Models in OpenCode

After authentication, select a Copilot model:

```
# In OpenCode TUI
/models

# Or specify in config
"model": "copilot-ghe/gpt-4o"
```

Available models (may vary based on your Copilot subscription):
- `copilot-ghe/gpt-4o`
- `copilot-ghe/claude-opus-4.6`
- `copilot-ghe/gpt-5.2-codex`

## Manual Authentication (Advanced)

If you need to manually perform the auth flow:

### Step 1: Get Device Code

```bash
curl -s -X POST "https://schibsted.ghe.com/login/device/code" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{"client_id":"Iv1.b507a08c87ecfe98","scope":"copilot"}'
```

Response:
```json
{
  "device_code": "...",
  "user_code": "XXXX-XXXX",
  "verification_uri": "https://schibsted.ghe.com/login/device",
  "expires_in": 900,
  "interval": 5
}
```

### Step 2: Authorize in Browser

1. Go to `https://schibsted.ghe.com/login/device`
2. Enter the `user_code`
3. Authorize GitHub Copilot

### Step 3: Poll for OAuth Token

```bash
curl -s -X POST "https://schibsted.ghe.com/login/oauth/access_token" \
  -H "Accept: application/json" \
  -H "Content-Type: application/json" \
  -d '{
    "client_id": "Iv1.b507a08c87ecfe98",
    "device_code": "<DEVICE_CODE>",
    "grant_type": "urn:ietf:params:oauth:grant-type:device_code"
  }'
```

Response (after authorization):
```json
{
  "access_token": "ghu_...",
  "token_type": "bearer",
  "github_host": "schibsted.ghe.com"
}
```

### Step 4: Exchange for Session Token

```bash
curl -s -H "Authorization: token ghu_..." \
  -H "Accept: application/json" \
  "https://api.schibsted.ghe.com/copilot_internal/v2/token"
```

Response:
```json
{
  "token": "tid=...;exp=...",
  "expires_at": 1770982527
}
```

### Step 5: Update auth.json

```bash
# The session token goes in ~/.local/share/opencode/auth.json
{
  "copilot-ghe": {
    "type": "api",
    "key": "<SESSION_TOKEN>"
  }
}
```

## Troubleshooting

### "OAuth token expired or revoked"

Run `login` to re-authenticate:
```bash
npx tsx scripts/copilot-ghe-auth.ts login
```

### "Session token request failed: 401"

Your OAuth token may have been revoked. Run `login` again.

### "Device code expired"

The device code expires in 15 minutes. Restart the `login` flow.

### Token expires during long session

The systemd timer automatically refreshes every 20 minutes. If it's not working:

```bash
# Check timer status
systemctl --user status copilot-ghe-refresh.timer

# Check for errors in recent runs
journalctl --user -u copilot-ghe-refresh -n 50

# Manually trigger refresh
systemctl --user start copilot-ghe-refresh.service
```

If systemd timer isn't available, use cron:
```bash
# Refresh every 20 minutes
*/20 * * * * cd ~/dotfiles && npx tsx scripts/copilot-ghe-auth.ts refresh 2>&1 | logger -t copilot-refresh
```

### Systemd timer not refreshing

1. Ensure OAuth token is cached (run `login` first)
2. Check timer is enabled: `systemctl --user enable copilot-ghe-refresh.timer`
3. Verify PATH in service has access to `npx` and `tsx`

### Different GHE host

Set the `GHE_HOST` environment variable:
```bash
GHE_HOST=your-company.ghe.com npx tsx scripts/copilot-ghe-auth.ts login
```

## Technical Details

### Client ID

The client ID `Iv1.b507a08c87ecfe98` is GitHub Copilot's official OAuth application ID, used across all Copilot integrations.

### Session Token Format

The session token is a semicolon-separated string containing:
- `tid` - Transaction ID
- `ol` - Organization/license info
- `exp` - Expiration timestamp (Unix seconds)
- `sku` - License type (e.g., `copilot_for_business_seat_quota`)
- Feature flags (`chat`, `agent_mode`, `mcp`, etc.)
- Signature hash

### API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `https://{host}/login/device/code` | Start device code flow |
| `https://{host}/login/oauth/access_token` | Exchange device code for OAuth token |
| `https://api.{host}/copilot_internal/v2/token` | Exchange OAuth for session token |
| `https://copilot-api.{host}` | Copilot chat/completion API |

## Related Files

- `scripts/copilot-ghe-auth.ts` - Authentication management script
- `etc/nixos/home.nix` - Systemd timer configuration
- `opencode.json` - Provider configuration
- `~/.local/share/opencode/auth.json` - Session token storage
- `~/.local/share/opencode/copilot-ghe-oauth.json` - Cached OAuth token
