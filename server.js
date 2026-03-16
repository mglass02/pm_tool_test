const express = require('express');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || '';
const STATE_FILE = path.join(__dirname, 'state.json');

// Minimal in-memory state with optional persistence
let state = { todo: [], inProgress: [], done: [] };

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return;
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (data && data.todo && data.inProgress && data.done) state = data;
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

function normalizeIssue(issue) {
  return {
    id: issue.id,
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
  };
}

function removeIssueEverywhere(number) {
  state.todo = state.todo.filter((i) => i.number !== number);
  state.inProgress = state.inProgress.filter((i) => i.number !== number);
  state.done = state.done.filter((i) => i.number !== number);
}

function moveIssue(number, target, payloadIssue) {
  removeIssueEverywhere(number);
  if (payloadIssue) {
    state[target].unshift(normalizeIssue(payloadIssue));
  } else {
    // Keep minimal record if we only have the number
    state[target].unshift({ id: number, number, title: `Issue #${number}`, url: '' });
  }
  saveState();
  io.emit('state', state);
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

  if (event === 'issues') {
    if (payload.action === 'opened' && payload.issue) {
      const issue = normalizeIssue(payload.issue);
      removeIssueEverywhere(issue.number);
      state.todo.unshift(issue);
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
        moveIssue(issueNumber, 'inProgress');
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
        moveIssue(issueNumber, 'done');
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
