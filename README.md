# Xen Code

Xen Code is a desktop control surface for the coding agents on your machine. It works with your own subscriptions to Claude Code, Codex, Cursor, Grok Build, OpenCode, Google Antigravity, and fx: if they're set up on your computer, Xen Code can drive them.

## Credits

Xen Code is a fork of [T3 Code](https://github.com/pingdotgg/t3code) by T3 Tools Inc., used under the [MIT License](./LICENSE). The architecture, the server, and the large majority of the code are their work. Xen Code is not affiliated with or endorsed by T3 Tools.

## Installation

Install and authenticate at least one provider first:

- Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
- Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
- Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
- Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
- OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
- Antigravity: enable it in Settings, then use **Install Antigravity** and **Sign in with Google**. No CLI is required.
- fx: install [fx](https://fx.sh) and run `fx login` ([setup guide](./docs/user/providers-fx.md))

Then download the desktop app from [GitHub Releases](https://github.com/KLI31/t3code/releases):

- **Windows:** `Xen-Code-<version>-x64.exe`
- **Debian, Ubuntu:** `sudo apt install ./Xen-Code-*.deb`
- **Other Linux:** `Xen-Code-<version>-x86_64.AppImage`

The app updates itself from the same releases page.

## Documentation

Full docs live in [docs/](./docs). Many pages still describe upstream T3 Code; features that depend on T3's hosted services (T3 Connect, the hosted web app, the mobile apps) are not part of Xen Code builds.

- [FAQ](./docs/user/faq.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Keyboard shortcuts](./docs/user/keybindings.md)
- [Project settings](./docs/user/project-settings.md)
- [Appearance preferences](./docs/user/appearance.md)
- [Connect Claude Code, Codex, ChatGPT and other agents over MCP](./docs/user/outside-agents.md)
- [Source control integrations](./docs/user/source-control.md)
- Multiple accounts: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- [Product usage data](./docs/user/telemetry.md) (off by default)

## Building from source

Start at [docs/internals/overview.md](./docs/internals/overview.md). The repo uses Vite+, so install the global `vp` tool ([guide](https://viteplus.dev/guide/)):

```bash
curl -fsSL https://vite.plus | bash   # macOS / Linux
irm https://vite.plus/ps1 | iex       # Windows
```

Then:

```bash
vp i
vp run dev
```

Bugs and ideas go in [Issues](https://github.com/KLI31/t3code/issues).
