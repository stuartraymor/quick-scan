# Set up my AI app

In the Windows desktop app, open **AI → Rebuild with AI → Set up my AI app**. Quick Scan configures existing Claude Code, Claude Desktop and Codex configuration folders, reports each result, and asks for the existing data-sharing consent before enabling the connection. Fully quit and reopen the AI app once. Node.js 22+ and `npx` must already be available to the AI app; the connector package is `scanruler-mcp@latest` (0.6.1 at verification).

The browser version retains manual setup instructions. An administrator's managed MCP restrictions or a client-specific disabled-server setting may still require action in that client.

## What setup changes

- Claude Code: the user-scoped `mcpServers.scanruler` entry in `~/.claude.json`. It does not add a project `.mcp.json` approval requirement.
- Claude Desktop: `mcpServers.scanruler` in `%APPDATA%/Claude/claude_desktop_config.json`, with an output directory under Documents/Quick Scan.
- Codex: the `mcp_servers.scanruler` table in `~/.codex/config.toml`, with a 60-second startup timeout and 300-second tool timeout.
- The connector's own `%APPDATA%/scanruler-mcp/config.json` supplies the same pairing token to the app. A configured custom port is passed explicitly to the server. `SCANRULER_MCP_CONFIG_DIR` is respected when set.

Other servers and settings remain intact. Changed existing files receive a `.bak-quickscan` backup before atomic replacement. Malformed JSON is reported without writing that file. App folders that do not exist are skipped. Setup does not restart AI apps or run their tools.

The connection's enabled/disabled choice and previously accepted consent are recorded outside version-specific Electron profiles in QuickScan-shared/agent-preferences.json. A later version can restore that recorded choice and connector pairing. No consent is inferred from a pairing file, and a new installation still shows the data warning. Versions released before this persistence feature cannot retroactively record their consent; the first setup may ask again.

## Diagnostics

After ten seconds without a connector, the wizard tells the user to restart the AI app fully or rerun setup. The compact status chip exposes the same explanation in its tooltip. A refused connection explains a potential token mismatch or another connected window; rerunning setup restores the pairing values. A successful configuration result is distinct from an active connection: the status must say connected after the AI app restarts.

## Verification

Tests use temporary home/APPDATA directories rather than the user's AI configuration. They cover JSON/TOML preservation, malformed files, absent apps, backups, repeated setup, multiline TOML instructions and following array tables, custom ports, and recorded consent/off choices. The browser workflow invokes the real setup backend against those directories, accepts the actual consent dialog, connects a real scanruler-mcp server, reads session state, simulates a new version profile, and repairs a real token mismatch. Packaged Electron smoke also exercises the guarded IPC/preload setup bridge using a separate fixture.

Fresh-user interactive restarts of all three third-party AI clients are a manual follow-up; automated tests do not claim those UI restarts occurred.

Primary configuration references: [Codex MCP configuration](https://developers.openai.com/codex/mcp), [Claude Code MCP scopes](https://code.claude.com/docs/en/mcp), [Claude Desktop local MCP setup](https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-local-servers).
