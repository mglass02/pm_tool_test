const express = require('express');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const STATE_FILE = path.join(__dirname, 'state.json');

// In-memory state with optional persistence
// Shape: { projects: { [projectId]: { id, repo, name, issues: { [number]: issue }, order: { todo: [], inProgress: [], done: [] } } } }
let state = { projects: {} };

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return;
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (data && data.projects) state = data;
  } catch (_) {
    // Ignore malformed file
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (_) {
    // Ignore write errors for MVP
  }
}

function cleanTitle(title) {
  return title.replace(/^\s*\[[^\]]+\]\s*/u, '').trim();
}

function getProjectNameFromTitle(title) {
  const match = title.match(/^\s*\[([^\]]+)\]\s*/u);
  return match ? match[1].trim() : 'General';
}

function getProjectNameFromBranch(branch) {
  const match = branch.match(/^([a-z0-9-]+)\//i);
  return match ? match[1] : 'General';
}

function normalizeIssue(issue, projectName) {
  const summary = issue.body ? issue.body.split('\n')[0].slice(0, 140) : '';
  return {
    id: issue.id,
    number: issue.number,
    title: cleanTitle(issue.title),
    url: issue.html_url,
    assignee: issue.assignee ? issue.assignee.login : null,
    author: issue.user ? issue.user.login : null,
    summary,
    status: 'todo',
    branch: null,
    pr: null,
    startedAt: null,
    mergedAt: null,
    createdAt: issue.created_at || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    projectName,
  };
}

function getProjectId(repoFullName, projectName) {
  return `${repoFullName}::${projectName}`;
}

function getProject(repoFullName, projectName) {
  const id = getProjectId(repoFullName, projectName);
  if (!state.projects[id]) {
    state.projects[id] = {
      id,
      repo: repoFullName,
      name: projectName,
      issues: {},
      order: { todo: [], inProgress: [], done: [] },
    };
  }
  return state.projects[id];
}

function removeFromOrders(project, number) {
  project.order.todo = project.order.todo.filter((n) => n !== number);
  project.order.inProgress = project.order.inProgress.filter((n) => n !== number);
  project.order.done = project.order.done.filter((n) => n !== number);
}

function placeInOrder(project, status, number) {
  removeFromOrders(project, number);
  project.order[status].unshift(number);
}

function upsertIssue(project, issue) {
  project.issues[issue.number] = issue;
  return issue;
}

function moveIssue(project, number, target, patch = {}) {
  const existing = project.issues[number];
  const issue = existing
    ? { ...existing, ...patch }
    : {
        id: number,
        number,
        title: `Issue #${number}`,
        url: '',
        assignee: null,
        author: null,
        summary: '',
        status: target,
        branch: null,
        pr: null,
        startedAt: null,
        mergedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
  issue.status = target;
  issue.updatedAt = new Date().toISOString();
  upsertIssue(project, issue);
  placeInOrder(project, target, number);
  saveState();
  io.emit('state', state);
}

function fetchIssueDetails(fullName, number) {
  if (!GITHUB_TOKEN) return Promise.resolve(null);
  const options = {
    hostname: 'api.github.com',
    path: `/repos/${fullName}/issues/${number}`,
    method: 'GET',
    headers: {
      'User-Agent': 'pm-tool',
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
    },
  };

  return new Promise((resolve) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve(JSON.parse(data));
          } else {
            resolve(null);
          }
        } catch (_) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

// Verify GitHub signature if secret is provided
function verifySignature(req, res, buf) {
  if (!WEBHOOK_SECRET) return;
  const signature = req.headers['x-hub-signature-256'] || '';
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  const digest = `sha256=${hmac.update(buf).digest('hex')}`;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
    throw new Error('Invalid signature');
  }
}

app.use(
  express.json({
    verify: (req, res, buf) => verifySignature(req, res, buf),
  })
);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/state', (req, res) => {
  res.json(state);
});

app.post('/webhook', (req, res) => {
  const event = req.headers['x-github-event'];
  const payload = req.body;
  const repoFullName = payload.repository && payload.repository.full_name ? payload.repository.full_name : 'unknown/unknown';

  if (event === 'issues') {
    if (payload.action === 'opened' && payload.issue) {
      const projectName = getProjectNameFromTitle(payload.issue.title || 'General');
      const project = getProject(repoFullName, projectName);
      const issue = normalizeIssue(payload.issue, projectName);
      upsertIssue(project, issue);
      placeInOrder(project, 'todo', issue.number);
      saveState();
      io.emit('state', state);
    }
  }

  if (event === 'create') {
    // Branch created: move issue to In Progress if branch name contains issue number
    if (payload.ref_type === 'branch' && payload.ref) {
      const match = payload.ref.match(/\b(\d+)\b/);
      if (match) {
        const issueNumber = Number(match[1]);
        const projectName = getProjectNameFromBranch(payload.ref);
        const project = getProject(repoFullName, projectName);
        const existing = project.issues[issueNumber];
        const startedAt = new Date().toISOString();
        if (existing) {
          moveIssue(project, issueNumber, 'inProgress', { branch: payload.ref, startedAt });
        } else {
          fetchIssueDetails(repoFullName, issueNumber).then((issue) => {
            if (issue) {
              const normalized = normalizeIssue(issue, projectName);
              moveIssue(project, issueNumber, 'inProgress', {
                ...normalized,
                branch: payload.ref,
                startedAt,
              });
            } else {
              moveIssue(project, issueNumber, 'inProgress', {
                branch: payload.ref,
                startedAt,
                projectName,
              });
            }
          });
          res.status(202).send('Accepted');
          return;
        }
      }
    }
  }

  if (event === 'pull_request') {
    if (payload.action === 'closed' && payload.pull_request && payload.pull_request.merged) {
      const pr = payload.pull_request;
      // Prefer issue number from branch name, fallback to PR title or body
      const source = `${pr.head && pr.head.ref ? pr.head.ref : ''} ${pr.title || ''} ${pr.body || ''}`;
      const match = source.match(/\b(\d+)\b/);
      if (match) {
        const issueNumber = Number(match[1]);
        const mergedAt = pr.merged_at || new Date().toISOString();
        const projectName = pr.head && pr.head.ref ? getProjectNameFromBranch(pr.head.ref) : 'General';
        const project = getProject(repoFullName, projectName);
        moveIssue(project, issueNumber, 'done', {
          pr: pr.html_url || null,
          mergedAt,
        });
      }
    }
  }

  res.status(200).send('OK');
});

io.on('connection', (socket) => {
  socket.emit('state', state);
});

loadState();

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
