# dsh-figma-design-lens-cat

Figma design understanding for AI coding agents.

It reads a Figma screen and produces the information an implementation needs:
every element's true geometry, its colours and type, the artwork that cannot
be rebuilt from data, and the arrangement the designer set up. It then renders
what a model generated from that information on web, iOS and Android, and
scores it against Figma's own render of the same screen -- so the quality of
the extraction is measured rather than assumed.

![The review page for one screen](docs/images/ui-screen.png)

## What it is for

A model given a list of Figma nodes writes plausible code that does not match
the design. The gap is rarely the model: it is what the node list leaves out.
The REST API returns no width or height on any node, omits every property left
at its default, and describes a rotated shape by the box around it rather than
the shape itself.

This tool closes that gap, and proves it did by rendering the result.

## Install

```bash
npm install -g dsh-figma-design-lens-cat
```

Or from source, for local development -- the global command then runs this checkout:

```bash
git clone https://github.com/tianxia--/dsh-figma-design-lens-cat.git
cd dsh-figma-design-lens-cat
npm install
npm link

# Confirm which checkout the global command points at
npm ls -g dsh-figma-design-lens-cat
```

`npm link` points the global command at the checkout. If the checkout is moved or deleted, the command stops working until `npm link` is run again from its new location.

## First-time setup

Run the guided setup after installing. It walks through two things:

```bash
dsh-figma-design-lens-cat setup
```

1. **A Figma token** (required) -- `inspect` and `add` cannot read a design without one.
2. **A model for code generation** (optional, strongly recommended) -- rendering a screen to web, iOS or Android code uses a large language model. Without one, renders fall back to a template that only places boxes and text, and score far lower. Analysis itself (`add`, `inspect`, the MCP tools) works either way.

### Figma token

Create the token in Figma: **Account settings → Personal access tokens**. Do not paste the token into chat or commit it. Save it locally with either command:

```bash
dsh-figma-design-lens-cat token <your-figma-token>
# or
dsh-figma-design-lens-cat config --token <your-figma-token>
```

### Model

`setup` asks before changing anything. If you agree, it installs the optional package `@earendil-works/pi-ai` when it is missing, asks which subscription to use, and opens the browser to sign in:

| Provider | Subscription | Default model |
|---|---|---|
| `anthropic` | Claude Pro / Max | `claude-sonnet-4-5` |
| `openai-codex` | ChatGPT Plus / Pro (via Codex) | `gpt-5.5` |
| `github-copilot` | GitHub Copilot | `claude-sonnet-4.6` |

Or from the review UI: open **Settings → Model for code generation**. It installs the package if it is missing and signs in to Claude or Codex: the sign-in page opens in a new tab and the page updates by itself when you finish. If the browser cannot return to this machine on its own, paste the code it shows into the box on the page. Sign-in, test, switching the provider renders use, and sign-out all live there. They only answer requests from the machine the UI runs on.

The same steps by hand:

```bash
# Only needed if the package is missing (doctor says so)
cd "$(npm root -g)/dsh-figma-design-lens-cat" && npm install --include=optional

# Sign in; the provider you sign in to becomes the one renders use
dsh-figma-design-lens-cat llm login anthropic

# Switch provider or model later
dsh-figma-design-lens-cat config --llm-provider openai-codex
dsh-figma-design-lens-cat config --llm-model gpt-5.4
```

### Verify

```bash
dsh-figma-design-lens-cat doctor       # token, package and model
dsh-figma-design-lens-cat llm status   # which model renders use, and whether its login still works
```

The same check is on the review UI's Settings page, under **Environment check**.

## Use

```bash
# What a Figma link actually holds -- a screen, or a canvas of many
dsh-figma-design-lens-cat inspect '<figma link>'

# Analyse one screen (alias: analyze)
dsh-figma-design-lens-cat add '<figma link>'
dsh-figma-design-lens-cat add '<figma link>' --project <label> --detectors

# Open the local review UI (default port 7420)
dsh-figma-design-lens-cat serve
dsh-figma-design-lens-cat serve --port 7421

# What has been analysed
dsh-figma-design-lens-cat list
dsh-figma-design-lens-cat projects
dsh-figma-design-lens-cat screens <project>
```

Everything stays on the machine it runs on. Nothing is uploaded.

![The screens in a project](docs/images/ui-projects.png)

## What it extracts

| | |
|---|---|
| **Geometry** | True width, height and origin, recovered from the bounding box by inverting the rotation. Verified to 0.0000pt against known rectangles. |
| **Colour** | Fills including blended layers: a second fill set to COLOR_DODGE lightens what is under it, and taking only the first loses that. |
| **Type** | Family, size, weight, alignment, and the size at which a string fits its measured box in a fallback font. |
| **Artwork** | Vectors, boolean operations and photos exported as images, because their outlines are not in the data at any size. |
| **Effects** | Shadows and blurs, with a background blur kept apart from a layer blur: they are different APIs and confusing them smears the content. |
| **Layout** | The direction, gap, padding and alignment a designer set up -- as intent. Coordinates remain the source of truth. |
| **Clipping** | Whether a node cuts off what overflows it. |

## How the result is checked

Generation is verified rather than trusted. Every emitted element carries its
node id -- `data-id` on web, `accessibilityIdentifier` on SwiftUI,
`testTag` on Compose -- and the output is compared against the list it was
given. Anything missing is sent back in a second pass that adds only the gap,
up to three rounds, keeping whatever was already correct.

Failures are never silent. A build that does not compile, an expired login, an
analysis older than the pipeline -- each says so instead of leaving a previous
result in place.

## Fidelity

Two screens of a file the tool had not seen, rendered from the extraction and
scored against Figma's own render. Left to right: the design, then web, iOS
and Compose.

![The same screens on three platforms](docs/images/fidelity.png)

| screen | web | iOS | Compose |
|---|---|---|---|
| scene list | 85.5 | 81.5 | 79.6 |
| lesson detail | 85.3 | 74.6 | 79.5 |

Photography, rounded cards, status pills and CJK text all come through. What
remains is dominated by fonts: a commercial family that is not installed
cannot be obtained through the API, and text set in a substitute has different
metrics however exactly it is positioned.

## Agent workflow

When an agent is asked to implement, rebuild, reproduce or review UI from a `figma.com` link, this package should be the first design-understanding step:

```bash
# MCP equivalent: analyze_design
# CLI equivalent:
dsh-figma-design-lens-cat add '<figma link>'
```

Then read the implementation spec instead of starting from raw Figma REST nodes:

```bash
# MCP: get_implementation_spec, then get_components/get_assets as needed
dsh-figma-design-lens-cat screens <project>
```

See [Agent Figma implementation workflow](docs/agent-figma-implementation.md) for the mandatory agent order, fallback rules, and what still belongs to downstream device or icon-conversion tools.

## MCP server

```bash
# See which clients are on this machine
dsh-figma-design-lens-cat install

# Wire it into one, or all of them
dsh-figma-design-lens-cat install claude
dsh-figma-design-lens-cat install all
```

Claude Code, Claude Desktop, Cursor and Codex are written directly; the rest
of each config is left as it was, and a file that does not parse is reported
rather than replaced. Restart the client afterwards -- for a desktop app, quit
it with Cmd+Q; closing the window is not enough.

Claude Code and Codex start from a terminal, so they get the command name and
find it on the shell's PATH. Claude Desktop and Cursor get absolute paths to
node and to the server script instead: a desktop app's PATH is not the
shell's, and may not contain npm's global bin directory or node itself. After
changing Node versions or reinstalling the package somewhere else, run
`install` again -- `doctor` and the Settings page report an entry whose path
has gone stale.

On macOS, a desktop app cannot read files in your Desktop, Documents or
Downloads folders until it is granted access. A package installed from npm
lives outside them. A checkout linked from one of them with `npm link` fails
in Claude Desktop with `EPERM: operation not permitted` until Claude is allowed
in System Settings → Privacy & Security → Files and Folders.

By hand, if you prefer:

```bash
# Prints the exact entry for this machine, with absolute paths
dsh-figma-design-lens-cat install-mcp --client json
```

```json
{
  "mcpServers": {
    "dsh-figma-design-lens-cat": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/dsh-figma-design-lens-cat/bin/mcp.mjs"]
    }
  }
}
```

Eight tools: `analyze_design`, `list_projects`, `list_screens`,
`get_screen`, `get_implementation_spec`, `get_components`, `get_assets`,
`open_review`.

Everything the MCP server does is also a command, so an agent without MCP can
call the CLI instead:

```bash
dsh-figma-design-lens-cat add '<figma link>'   # analyse a screen
dsh-figma-design-lens-cat projects             # what has been analysed
dsh-figma-design-lens-cat screens <project>    # the screens in one
```

To print the config entry instead of writing it -- for a client `install` does not know:

```bash
dsh-figma-design-lens-cat install-mcp --client claude   # a `claude mcp add` command
dsh-figma-design-lens-cat install-mcp --client codex    # a ~/.codex/config.toml block
dsh-figma-design-lens-cat install-mcp --client json     # JSON for Claude Desktop, Cursor, Windsurf
```

## Background service (macOS)

Run the review UI in the background and start it at login, instead of keeping `serve` open in a terminal:

```bash
dsh-figma-design-lens-cat service install     # install and start now, and at every login
dsh-figma-design-lens-cat service status      # installed? loaded? listening?
dsh-figma-design-lens-cat service stop        # stop now (it returns at next login)
dsh-figma-design-lens-cat service start       # start it again
dsh-figma-design-lens-cat service restart     # pick up a code change
dsh-figma-design-lens-cat service logs        # last 40 log lines
dsh-figma-design-lens-cat service uninstall   # remove it completely
```

The service records the absolute path of the checkout it was installed from. After moving the checkout, run `service uninstall` and then `service install` again.

## Commands

Short alias for every command: `dlc`.

**Setup**

| | |
|---|---|
| `setup` | First-time guide: checks the Figma token and prints the next steps |
| `token <figma-token>` | Store the Figma token |
| `config --token <figma-token>` | Store the Figma token (same as `token`) |
| `config --detectors true\|false` | Turn the image-detector cross-check on or off by default |
| `config --llm-provider <provider>` | Choose which signed-in provider renders use |
| `config --llm-model <model>` | Override the model for that provider |
| `config` | Show the current settings, with the token redacted |
| `doctor` | Check Node, Python, Pillow/NumPy, the Figma token and the store |
| `env [capability]` | Check each capability (core, vision, web/iOS/Android render) and print a fix for what is missing |
| `env --setup-android` | Install the Gradle wrapper and proxy trust store for Android rendering |
| `env --trust-proxy` | Trust a TLS-inspecting corporate proxy for the Android build |

**Analysis**

| | |
|---|---|
| `inspect <link>` | What a node holds, before analysing it |
| `add <link> [--project <label>] [--detectors]` | Analyse one screen (alias: `analyze`) |
| `list` | Projects with screen counts and readiness |
| `projects` | Project identities, file keys and aliases |
| `screens <project>` | The screens in one project |
| `stale` | Which stored analyses predate the current pipeline |
| `reindex` | Rebuild the project index from the store |

**Review UI and service**

| | |
|---|---|
| `serve [--port 7420]` | Local review UI |
| `service install\|status\|stop\|start\|restart\|logs\|uninstall` | Run the review UI in the background (macOS) |

**Agents**

| | |
|---|---|
| `install` | List the MCP clients found on this machine |
| `install <client>` / `install all` | Wire the MCP server into `claude`, `claude-desktop`, `cursor`, `codex`, or all found |
| `install-mcp [--client claude\|codex\|json]` | Print the config entry instead of writing it |

**Code generation and benchmarks**

| | |
|---|---|
| `llm login [provider]` | Sign in for code generation and make it the provider renders use (`anthropic`, `openai-codex`, `github-copilot`; default `anthropic`) |
| `llm logout [provider]` | Sign out |
| `llm status [--offline]` | Which providers are signed in, which one renders use, and whether the login still works |
| `bench init <figma link> [--size 12]` | Pick a fixed set of screens to benchmark |
| `bench score --project <id> [--label <name>]` | Score the set and record the run |
| `bench history` | Every recorded run |
| `bench compare` | The last two runs, like for like |
| `bench show` | The screens in the set |

## Troubleshooting

**`command not found: dsh-figma-design-lens-cat`** -- the global link points at a checkout that was moved or deleted. Run `npm link` again from the checkout you want to use, then check with `npm ls -g dsh-figma-design-lens-cat`.

**`no Figma token configured`** -- run `dsh-figma-design-lens-cat setup` and follow the steps, then `dsh-figma-design-lens-cat doctor`.

**`listen EADDRINUSE: address already in use :::7420`** -- something already serves port 7420, usually the background service:

```bash
# What holds the port
lsof -nP -iTCP:7420 -sTCP:LISTEN

# If it is the background service, use it instead of `serve` -- or stop it
dsh-figma-design-lens-cat service status
dsh-figma-design-lens-cat service stop

# Or run on another port
dsh-figma-design-lens-cat serve --port 7421
```

**A background service from before the rename** -- versions named `design-lens-cat` installed a service under a different label, which `service uninstall` does not remove. It keeps serving the old code, even after that checkout is deleted. Remove it by hand:

```bash
launchctl bootout gui/$(id -u)/com.design-lens-cat.server
rm ~/Library/LaunchAgents/com.design-lens-cat.server.plist
```

**Renders look far worse than the design** -- check whether a model drew them. The review UI says "Rendered with the template, not a model" with the reason, and `render/<platform>/<screen>/meta.json` in the store records `"generator": "template"` and `fellBackBecause`. The usual causes are that no model is signed in, or that the optional package is missing -- often after moving or reinstalling the checkout, because it lives in that checkout's `node_modules`. Fix it in **Settings → Model for code generation**, or run `dsh-figma-design-lens-cat setup`, then render again. If renders still use the template after installing the package from a terminal, restart `serve`.

**A screen scores far lower than expected** -- it may have been analysed by an older pipeline. `dsh-figma-design-lens-cat stale` lists those; re-analyse them with `add`.

## Requirements

- Node 20 or newer
- Python 3 with Pillow and NumPy, for image comparison
- Chrome, for web rendering
- Xcode command line tools, for iOS rendering (macOS only)
- A JDK, for Compose rendering

Each is optional: a missing one disables its own target and nothing else.

## Licence

MIT
