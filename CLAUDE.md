# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

GSD Planner is a mobile-first PWA that helps users plan software projects through conversational AI. It generates planning files compatible with Claude Code's GSD workflow or a single comprehensive plan.md. Deployed on Netlify.

## Development

No build step. The app is plain HTML/CSS/JS served as static files.

```bash
# Local dev
netlify dev

# Deploy
netlify deploy --prod
```

The app runs at `http://localhost:8888` during local dev. The Netlify function is available at `/api/chat` (redirected from `/.netlify/functions/chat`).

## Architecture

**Frontend** (`index.html`, `app.js`, `style.css`): Single-page app with three screens (home, settings, chat). No framework — vanilla JS with DOM manipulation. Sessions and API keys stored in `localStorage`. Uses JSZip (CDN) for multi-file downloads.

**Backend** (`netlify/functions/chat.mjs`): Single Netlify serverless function that proxies requests to the Anthropic Messages API with streaming (SSE). The user's API key is passed from the frontend per-request — nothing is stored server-side. Two system prompts defined in `PROMPTS` object control the planning mode behavior.

**Data flow**: User message → frontend builds message history → POST `/api/chat` with messages + API key + model + mode → serverless function forwards to Anthropic API with appropriate system prompt → SSE stream piped back → frontend parses `content_block_delta` events and renders incrementally.

**File output**: When the AI generates planning files, it embeds them as tagged JSON code blocks (`json:gsd-files` or `json:plan-file`). The frontend extracts these via regex in `extractGsdFiles()` and renders a download card. Single files download as `.md`, multiple files as `.zip`.

## Planning Modes

- **GSD mode**: Generates 5 files (PROJECT.md, REQUIREMENTS.md, ROADMAP.md, STATE.md, config.json) in a `.planning/` directory structure
- **Plan.md mode**: Generates a single comprehensive plan.md file

The system prompts for both modes are defined inline in `netlify/functions/chat.mjs` in the `PROMPTS` object.

## Netlify Config

- Site ID: `c4d4e8d0-6f04-4c82-985a-20663a8639f3`
- Functions use esbuild bundler
- Redirect: `/api/chat` → `/.netlify/functions/chat`
