#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { Select } = require('enquirer');

const HOME = os.homedir();
const CONFIG_DIR = path.join(HOME, '.pmtool');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const STATE_FILE = path.join(CONFIG_DIR, 'state.json');

function ensureDir() {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function run(cmd) {
  return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
}

function getRepoFromGit() {
  try {
    const url = run('git remote get-url origin');
    const match = url.match(/github.com[:/](.+?)\.git$/);
    return match ? match[1] : null;
  } catch (_) {
    return null;
  }
}

function getToken() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN || null;
}

async function ghFetch(url) {
  const token = getToken();
  if (!token) throw new Error('Missing GITHUB_TOKEN or GH_TOKEN');
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'pm-tool-cli',
    },
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  return res.json();
}

async function fetchAll(url) {
  let page = 1;
  let results = [];
  while (true) {
    const data = await ghFetch(`${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!Array.isArray(data) || data.length === 0) break;
    results = results.concat(data);
    if (data.length < 100) break;
    page += 1;
  }
  return results;
}

function extractIssueNumber(text) {
  if (!text) return null;
  const match = text.match(/\b(\d+)\b/);
  return match ? Number(match[1]) : null;
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const hh = String(hours).padStart(2, '0');
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function pad(text, width) {
  const str = String(text);
  if (str.length >= width) return str.slice(0, width - 1) + '…';
  return str + ' '.repeat(width - str.length);
}

async function sync() {
  ensureDir();
  const config = readJson(CONFIG_FILE, {});
  const repo = config.repo || getRepoFromGit();
  if (!repo) throw new Error('Repo not set. Run: pm init');

  const issues = await fetchAll(`https://api.github.com/repos/${repo}/issues?state=all`);
  const branches = await fetchAll(`https://api.github.com/repos/${repo}/branches`);
  const pulls = await fetchAll(`https://api.github.com/repos/${repo}/pulls?state=closed`);

  const issueMap = new Map();
  issues
    .filter((i) => !i.pull_request)
    .forEach((i) => {
      issueMap.set(i.number, {
        id: i.id,
        number: i.number,
        title: i.title,
        url: i.html_url,
        assignee: i.assignee ? i.assignee.login : null,
        author: i.user ? i.user.login : null,
        summary: i.body ? i.body.split('\n')[0].slice(0, 140) : '',
        createdAt: i.created_at,
      });
    });

  const branchToIssue = new Map();
  branches.forEach((b) => {
    const issueNum = extractIssueNumber(b.name);
    if (issueNum) branchToIssue.set(issueNum, b.name);
  });

  const doneSet = new Map();
  pulls.forEach((pr) => {
    if (!pr.merged_at) return;
    const source = `${pr.head && pr.head.ref ? pr.head.ref : ''} ${pr.title || ''} ${pr.body || ''}`;
    const issueNum = extractIssueNumber(source);
    if (issueNum) {
      doneSet.set(issueNum, {
        mergedAt: pr.merged_at,
        pr: pr.html_url,
      });
    }
  });

  const todo = [];
  const inProgress = [];
  const done = [];

  for (const [num, issue] of issueMap.entries()) {
    if (doneSet.has(num)) {
      const merged = doneSet.get(num);
      done.push({
        ...issue,
        status: 'done',
        branch: branchToIssue.get(num) || null,
        pr: merged.pr,
        startedAt: issue.createdAt,
        mergedAt: merged.mergedAt,
      });
    } else if (branchToIssue.has(num)) {
      inProgress.push({
        ...issue,
        status: 'inProgress',
        branch: branchToIssue.get(num),
        startedAt: issue.createdAt,
        mergedAt: null,
      });
    } else if (issue) {
      todo.push({
        ...issue,
        status: 'todo',
        branch: null,
        startedAt: issue.createdAt,
        mergedAt: null,
      });
    }
  }

  const state = {
    repo,
    syncedAt: new Date().toISOString(),
    columns: { todo, inProgress, done },
  };

  writeJson(STATE_FILE, state);
  return state;
}

function formatTimeStamp(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function isWithinDays(iso, days) {
  if (!iso) return false;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return new Date(iso).getTime() >= cutoff;
}

function printBoard(state) {
  const { todo, inProgress, done } = state.columns;

  function printColumn(title, items) {
    console.log(`\n${title}`);
    console.log('-'.repeat(title.length));
    items.forEach((item) => {
      const time = item.mergedAt
        ? formatDuration(new Date(item.mergedAt) - new Date(item.startedAt))
        : '';
      const suffix = time ? ` (${time})` : '';
      console.log(`#${item.number} ${item.title}${suffix}`);
    });
  }

  console.log(`Repo: ${state.repo}`);
  console.log(`Last sync: ${state.syncedAt}`);
  printColumn('To Do', todo);
  printColumn('In Progress', inProgress);
  printColumn('Done', done);
}

function printBoardLimited(state, limit) {
  const { todo, inProgress, done } = state.columns;
  const l = Number.isFinite(limit) ? limit : 5;
  const trim = (items) => items.slice(0, l);
  console.log(`Repo: ${state.repo}`);
  console.log(`Last sync: ${state.syncedAt}`);
  printBoard({
    ...state,
    columns: {
      todo: trim(todo),
      inProgress: trim(inProgress),
      done: trim(done),
    },
  });
}

function printFocus(state) {
  const { todo, inProgress } = state.columns;
  const now = Date.now();
  const byOldest = (a, b) => new Date(a.createdAt) - new Date(b.createdAt);
  const oldestInProgress = [...inProgress].sort(byOldest);
  const oldestTodo = [...todo].sort(byOldest);

  console.log(`Repo: ${state.repo}`);
  console.log(`Last sync: ${state.syncedAt}`);
  console.log('');
  console.log('FOCUS');
  console.log('-----');

  if (oldestInProgress.length) {
    console.log('In Progress (oldest first)');
    oldestInProgress.slice(0, 3).forEach((item) => {
      const age = formatDuration(now - new Date(item.startedAt).getTime());
      console.log(`#${item.number} ${item.title}  |  time so far: ${age}`);
    });
  } else {
    console.log('No active work in progress.');
  }

  console.log('');
  console.log('Next Up (oldest To Do)');
  oldestTodo.slice(0, 3).forEach((item) => {
    const age = formatDuration(now - new Date(item.createdAt).getTime());
    console.log(`#${item.number} ${item.title}  |  age: ${age}`);
  });
}

function printNext(state) {
  const { todo, inProgress } = state.columns;
  const byOldest = (a, b) => new Date(a.createdAt) - new Date(b.createdAt);
  if (inProgress.length) {
    const pick = [...inProgress].sort(byOldest)[0];
    console.log(`Keep going: #${pick.number} ${pick.title}`);
    return;
  }
  if (todo.length) {
    const pick = [...todo].sort(byOldest)[0];
    console.log(`Next task: #${pick.number} ${pick.title}`);
    return;
  }
  console.log('No tasks found.');
}

async function tasksView(state, options = {}) {
  const { todo, inProgress, done } = state.columns;
  const limit = Number.isFinite(options.limit) ? options.limit : null;
  const done7d = done.filter((i) => isWithinDays(i.mergedAt, 7));
  const durations = done
    .map((i) => new Date(i.mergedAt) - new Date(i.startedAt))
    .filter((n) => Number.isFinite(n) && n > 0);
  const avg = durations.length ? formatDuration(durations.reduce((a, b) => a + b, 0) / durations.length) : '—';

  console.log(`Repo: ${state.repo}`);
  console.log(`Sync: ${formatTimeStamp(state.syncedAt)}`);
  console.log(
    `To Do: ${todo.length}  |  In Progress: ${inProgress.length}  |  Done (7d): ${done7d.length}  |  Avg Time Taken (HH:MM:SS): ${avg}`
  );
  console.log('Time taken format: HH:MM:SS');
  console.log('');

  while (true) {
    const prompt = new Select({
      name: 'column',
      message: 'Select a column to view',
      choices: ['To Do', 'In Progress', 'Done (7d)', 'Done (all)', 'Exit'],
    });

    const choice = await prompt.run();
    if (choice === 'Exit') break;

    let items = [];
    if (choice === 'To Do') items = todo;
    if (choice === 'In Progress') items = inProgress;
    if (choice === 'Done (7d)') items = done7d;
    if (choice === 'Done (all)') items = done;
    if (limit) items = items.slice(0, limit);

    console.log(`\n${choice}`);
    console.log('-'.repeat(choice.length));
    console.log(`${pad('ID', 6)} ${pad('Title', 52)} ${pad('Time Taken (HH:MM:SS)', 22)}`);
    console.log(`${'-'.repeat(6)} ${'-'.repeat(52)} ${'-'.repeat(22)}`);
    if (!items.length) {
      console.log('(none)\n');
      continue;
    }
    items.forEach((item) => {
      const time = item.mergedAt
        ? formatDuration(new Date(item.mergedAt) - new Date(item.startedAt))
        : '';
      const timeDisplay = time || '—';
      console.log(`${pad(`#${item.number}`, 6)} ${pad(item.title, 52)} ${pad(timeDisplay, 22)}`);
    });
    console.log('');
  }
}

function printAvg(state) {
  const done = state.columns.done;
  if (!done.length) {
    console.log('No completed items.');
    return;
  }
  const durations = done
    .map((i) => new Date(i.mergedAt) - new Date(i.startedAt))
    .filter((n) => Number.isFinite(n) && n > 0);
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  console.log(`Average time to complete: ${formatDuration(avg)}`);
}

function printCurrent(state) {
  let branch = null;
  try {
    branch = run('git rev-parse --abbrev-ref HEAD');
  } catch (_) {
    console.log('Not a git repo.');
    return;
  }
  const issueNum = extractIssueNumber(branch);
  if (!issueNum) {
    console.log(`Current branch: ${branch} (no issue number detected)`);
    return;
  }
  const issue = state.columns.inProgress.find((i) => i.number === issueNum);
  if (!issue) {
    console.log(`Current branch: ${branch} (issue #${issueNum} not in progress)`);
    return;
  }
  const elapsed = Date.now() - new Date(issue.startedAt).getTime();
  console.log(`Current branch: ${branch}`);
  console.log(`Time so far: ${formatDuration(elapsed)}`);
}

async function main() {
  const cmd = process.argv[2] || 'tasks-view';
  ensureDir();

  if (cmd === 'init') {
    const repo = getRepoFromGit();
    if (!repo) {
      console.log('Could not detect repo. Run this in a git repo with origin set.');
      process.exit(1);
    }
    writeJson(CONFIG_FILE, { repo });
    console.log(`Initialized for repo: ${repo}`);
    return;
  }

  if (cmd === 'sync') {
    const state = await sync();
    console.log(`Synced ${state.columns.todo.length + state.columns.inProgress.length + state.columns.done.length} issues.`);
    return;
  }

  if (cmd === 'help') {
    console.log('PM Tool CLI');
    console.log('-----------');
    console.log('Commands:');
    console.log('  pm init           Initialize repo context from git remote');
    console.log('  pm sync           Sync issues, branches, and PRs from GitHub');
    console.log('  pm tasks-view     Interactive view with column selection');
    console.log('                   --limit N   Limit items shown per column');
    console.log('  pm focus          Show oldest in-progress and next tasks');
    console.log('  pm next           Recommend the single next task');
    console.log('  pm avg            Average time taken for completed tasks');
    console.log('  pm current        Show time spent on current branch');
    console.log('  pm doctor         Check GitHub auth, repo, and connectivity');
    console.log('  pm help           Show this help');
    return;
  }

  if (cmd === 'doctor') {
    const repo = readJson(CONFIG_FILE, {}).repo || getRepoFromGit();
    const token = getToken();
    console.log('PM Tool Doctor');
    console.log('--------------');
    console.log(`Repo detected: ${repo || 'not found'}`);
    console.log(`GitHub token: ${token ? 'present' : 'missing'}`);
    try {
      await ghFetch('https://api.github.com/user');
      console.log('GitHub API: reachable');
    } catch (err) {
      console.log(`GitHub API: error (${err.message})`);
    }
    return;
  }

  const state = fs.existsSync(STATE_FILE) ? readJson(STATE_FILE, null) : await sync();

  if (cmd === 'avg') {
    printAvg(state);
    return;
  }

  if (cmd === 'current') {
    printCurrent(state);
    return;
  }

  if (cmd === 'tasks-view') {
    const limitIdx = process.argv.indexOf('--limit');
    const limit = limitIdx !== -1 && process.argv[limitIdx + 1] ? Number(process.argv[limitIdx + 1]) : null;
    await tasksView(state, { limit });
    return;
  }

  if (cmd === 'focus') {
    printFocus(state);
    return;
  }

  if (cmd === 'next') {
    printNext(state);
    return;
  }

  console.log('Usage: pm init | pm sync | pm tasks-view [--limit N] | pm avg | pm current | pm focus | pm next | pm doctor | pm help');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
