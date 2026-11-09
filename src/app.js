const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('./store');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data)
  });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, file, type) {
  const target = path.join(PUBLIC_DIR, file);
  if (!target.startsWith(PUBLIC_DIR) || !fs.existsSync(target)) return false;
  res.writeHead(200, { 'Content-Type': type });
  res.end(fs.readFileSync(target));
  return true;
}

async function handler(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const route = `${req.method} ${url.pathname}`;

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return serveStatic(res, 'index.html', 'text/html; charset=utf-8');
  }
  if (req.method === 'GET' && url.pathname === '/style.css') {
    return serveStatic(res, 'style.css', 'text/css; charset=utf-8');
  }
  if (route === 'GET /api/health') {
    return json(res, 200, { status: 'ok' });
  }
  if (route === 'GET /api/signups') {
    return json(res, 200, { total: store.list().length, max: store.MAX_SIGNUPS, items: store.list() });
  }

  if (route === 'POST /api/signups') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    const employeeId = String(body.employeeId || '').trim();
    const department = String(body.department || '').trim();

    if (!name || !employeeId || !department) {
      return json(res, 400, { error: '姓名、工号、部门均为必填' });
    }
    if (store.isFull()) {
      return json(res, 409, { error: '报名人数已满' });
    }

    const item = store.add({ name, employeeId, department });
    return json(res, 201, { seq: item.seq, total: store.list().length });
  }

  return json(res, 404, { error: `not found: ${route}` });
}

function createServer() {
  return http.createServer((req, res) => {
    handler(req, res).catch((err) => json(res, 500, { error: err.message }));
  });
}

module.exports = { createServer, handler };
