const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'scoring-data.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Default initial state
const freshState = () => ({
  groups: [1, 2, 3, 4, 5].map(i => ({ id: "g" + i, name: "Group " + i, late: false, verified: false })),
  judges: [1, 2, 3, 4, 5].map(i => ({ id: "j" + i, name: "Judge " + i })),
  evals: {},
  lastUpdated: new Date().toISOString()
});

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(content);
    }
  } catch (err) {
    console.error('Error reading data file:', err);
  }
  const init = freshState();
  saveData(init);
  return init;
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error writing data file:', err);
  }
}

// Safe merge: merges incoming client state with server state without wiping evaluations
function mergeData(serverState, incoming) {
  if (!incoming) return serverState;

  // Groups
  if (Array.isArray(incoming.groups) && incoming.groups.length > 0) {
    const groupMap = new Map();
    serverState.groups.forEach(g => groupMap.set(g.id, g));
    incoming.groups.forEach(g => {
      const existing = groupMap.get(g.id);
      groupMap.set(g.id, existing ? { ...existing, ...g } : g);
    });
    serverState.groups = Array.from(groupMap.values());
  }

  // Judges
  if (Array.isArray(incoming.judges) && incoming.judges.length > 0) {
    const judgeMap = new Map();
    serverState.judges.forEach(j => judgeMap.set(j.id, j));
    incoming.judges.forEach(j => {
      const existing = judgeMap.get(j.id);
      judgeMap.set(j.id, existing ? { ...existing, ...j } : j);
    });
    serverState.judges = Array.from(judgeMap.values());
  }

  // Evaluations (key: "g1:j1", etc.)
  if (incoming.evals && typeof incoming.evals === 'object') {
    if (!serverState.evals) serverState.evals = {};
    for (const [key, ev] of Object.entries(incoming.evals)) {
      // If server doesn't have it or incoming has updated scores/submitted
      if (!serverState.evals[key]) {
        serverState.evals[key] = ev;
      } else {
        // Deep merge scores
        const existing = serverState.evals[key];
        serverState.evals[key] = {
          ...existing,
          ...ev,
          scores: { ...(existing.scores || {}), ...(ev.scores || {}) },
          // If either was submitted, prioritize submitted
          submitted: ev.submitted || existing.submitted
        };
      }
    }
  }

  serverState.lastUpdated = new Date().toISOString();
  return serverState;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  // CORS headers for multi-device cross-origin support
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;

  // API Endpoints
  if (pathname === '/api/data' && req.method === 'GET') {
    const data = loadData();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
    return;
  }

  if (pathname === '/api/sync' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const incoming = JSON.parse(body || '{}');
        const current = loadData();
        const merged = mergeData(current, incoming);
        saveData(merged);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, data: merged }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // Static File Serving
  let filePath = pathname === '/' ? path.join(__dirname, 'index.html') : path.join(__dirname, pathname);
  
  // Security: prevent directory traversal
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html if file not found
      filePath = path.join(__dirname, 'index.html');
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`MHC Christmas Presentation 2026 Server running on port ${PORT}`);
});
