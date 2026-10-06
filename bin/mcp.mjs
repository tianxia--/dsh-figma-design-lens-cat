#!/usr/bin/env node
// MCP entry point. Kept separate from the CLI so a client can launch the server
// without argument parsing getting in the way.
import "../src/mcp/server.mjs";
