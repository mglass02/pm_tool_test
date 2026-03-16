# PM Tool CLI (JSON storage MVP)

## What it does
A CLI-only project manager that derives status from GitHub activity:
- Issues created → **To Do**
- Branch created with issue number → **In Progress**
- PR merged → **Done**

## Install
### Local dev (from repo)

```bash
npm install
npm link
```

This registers the `pm` command locally.

### From npm (after publish)
```bash
npm install -g pm-tool
```

## Auth
You need a GitHub token available to the CLI:

```bash
export GITHUB_TOKEN=YOUR_TOKEN
# or
export GH_TOKEN=YOUR_TOKEN
```

## Quick start (2 minutes)
```bash
pm init         # detects repo from git remote
pm doctor       # validates GitHub auth + connectivity
pm sync         # fetches issues/branches/PRs from GitHub
pm tasks-view   # interactive column view
```

## Commands
- `pm init` — store repo in ~/.pmtool/config.json
- `pm sync` — fetch GitHub data and write ~/.pmtool/state.json
- `pm tasks-view` — interactive column view
- `pm tasks-view --limit N` — limit items per column
- `pm focus` — focus view (oldest in progress + next)
- `pm next` — single recommended next task
- `pm avg` — average time taken for completed tasks
- `pm current` — time spent on current branch
- `pm doctor` — check auth, repo, GitHub connectivity
- `pm help` — show command list

## How linking works
Branch names should include the issue number, e.g. `feature/123-login-fix`.
The CLI extracts the number and associates the work automatically.

## Storage
State is stored in:
- `~/.pmtool/config.json`
- `~/.pmtool/state.json`

These are JSON only (no DB).
