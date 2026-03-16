# PM Tool CLI (JSON storage MVP)

## What it does
A CLI-only project manager that derives status from GitHub activity:
- Issues created → **To Do**
- Branch created with issue number → **In Progress**
- PR merged → **Done**

## Install (local dev)
From the repo root:

```bash
npm install
npm link
```

This registers the `pm` command locally.

## Auth
You need a GitHub token available to the CLI:

```bash
export GITHUB_TOKEN=YOUR_TOKEN
# or
export GH_TOKEN=YOUR_TOKEN
```

## Quick start
```bash
pm init   # detects repo from git remote
pm sync   # fetches issues/branches/PRs from GitHub
pm board  # prints the board
```

## Commands
- `pm init` — store repo in ~/.pmtool/config.json
- `pm sync` — fetch GitHub data and write ~/.pmtool/state.json
- `pm board` — print To Do / In Progress / Done
- `pm avg` — average time to complete
- `pm current` — time spent on current branch

## How linking works
Branch names should include the issue number, e.g. `feature/123-login-fix`.
The CLI extracts the number and associates the work automatically.

## Storage
State is stored in:
- `~/.pmtool/config.json`
- `~/.pmtool/state.json`

These are JSON only (no DB).
