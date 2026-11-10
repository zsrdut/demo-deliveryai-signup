'use strict';

const http = require('node:http');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { validateRegistrationInput } = require('./validate');
const { createAdminAuth, SESSION_COOKIE } = require('./admin');
const { TIME_ZONE, formatShanghai, shanghaiFileStamp } = require('./time');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

const MAX_BODY_BYTES_DEFAULT = 8192;

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(body);
}

function sendError(res, status, code, message, extraHeaders = {}) {
  sendJson(res, status, { error: { code, message } }, extraHeaders);
}

function sendText(res, status, text, extraHeaders = {}) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(text);
}

/** 读取请求体，超过上限后不再累积数据，避免大请求占用内存。 */
function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];

    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve({ tooLarge, buffer: Buffer.concat(chunks) }));
    req.on('error', reject);
  });
}

function parseCookies(header) {
  const cookies = {};
  if (typeof header !== 'string') return cookies;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    const raw = part.slice(index + 1).trim();
    try {
      cookies[key] = decodeURIComponent(raw);
    } catch {
      cookies[key] = raw;
    }
  }
  return cookies;
}

function getClientKey(req) {
  // Vercel 会注入 x-real-ip；X-Forwarded-For 取最后一跳，避免客户端伪造首段绕过口令锁定。
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return realIp.trim();

  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const hops = forwarded
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function isSecureRequest(req) {
  if (process.env.VERCEL) return true;
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.split(',')[0].trim() === 'https') return true;
  return Boolean(req.socket && req.socket.encrypted);
}

function sessionCookie(token, secure) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

function csvCell(value) {
  let text = String(value === null || value === undefined ? '' : value);
  // 防止表格软件把用户输入当公式执行（CSV injection）。
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** CSV：UTF-8 BOM + 固定列顺序 + CRLF。 */
function buildCsv(records) {
  const lines = [['位次', '姓名', '工号', '部门', '报名时间'].map(csvCell).join(',')];
  for (const record of records) {
    lines.push(
      [
        record.position,
        record.name,
        record.employeeId,
        record.department,
        formatShanghai(record.registeredAt),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

/**
 * 创建 HTTP 请求处理函数（不监听端口），便于测试注入内存 store、时钟与口令。
 * @param {{store: ReturnType<import('./store').createRegistrationStore>,
 *          publicDir: string, adminPassword?: string, auth?: object,
 *          maxBodyBytes?: number, maxName?: number, maxEmployeeId?: number,
 *          maxDepartment?: number, now?: Function, sessionIdleMs?: number,
 *          lockMs?: number, maxLoginFailures?: number,
 *          logger?: {info: Function, warn: Function, error: Function}}} options
 */
function createRequestHandler(options) {
  const store = options.store;
  const publicDir = path.resolve(options.publicDir);
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES_DEFAULT;
  const limits = {
    maxName: options.maxName,
    maxEmployeeId: options.maxEmployeeId,
    maxDepartment: options.maxDepartment,
  };
  const logger = options.logger || console;

  const auth =
    options.auth ||
    createAdminAuth({
      password: options.adminPassword,
      now: options.now,
      sessionIdleMs: options.sessionIdleMs,
      lockMs: options.lockMs,
      maxFailures: options.maxLoginFailures,
    });

  const clock = options.now || (() => new Date());

  function nowDate() {
    const value = typeof clock === 'function' ? clock() : new Date();
    return value instanceof Date ? value : new Date(value);
  }

  function readSessionToken(req) {
    return parseCookies(req.headers.cookie)[SESSION_COOKIE];
  }

  function requireAdmin(req, res) {
    if (auth.authorize(readSessionToken(req))) return true;
    sendError(res, 401, 'UNAUTHORIZED', '请先输入管理口令');
    return false;
  }

  async function parseJsonBody(req, res) {
    const { tooLarge, buffer } = await readBody(req, maxBodyBytes);
    if (tooLarge) {
      sendError(res, 413, 'PAYLOAD_TOO_LARGE', '请求体过大', { Connection: 'close' });
      return null;
    }
    let parsed;
    try {
      parsed = JSON.parse(buffer.toString('utf8'));
    } catch {
      sendError(res, 400, 'INVALID_JSON', '请求体不是合法 JSON');
      return null;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      sendError(res, 400, 'INVALID_JSON', '请求体必须是 JSON 对象');
      return null;
    }
    return parsed;
  }

  async function handleRegister(req, res) {
    const parsed = await parseJsonBody(req, res);
    if (parsed === null) return;

    const result = validateRegistrationInput(parsed, limits);
    if (!result.ok) {
      const codes = Object.values(result.errors).map((error) => error.code).join(',');
      logger.info(`[signup] result=INVALID codes=${codes}`);
      sendJson(res, 400, {
        status: 'INVALID',
        message: '请检查填写内容',
        errors: result.errors,
      });
      return;
    }

    const outcome = store.register(result.value);

    if (outcome.status === 'SUCCESS') {
      logger.info(`[signup] result=SUCCESS position=${outcome.position}`);
      sendJson(res, 201, {
        status: 'SUCCESS',
        position: outcome.position,
        limit: store.limit,
        message: `报名成功，你是第 ${outcome.position} 位`,
      });
      return;
    }

    if (outcome.status === 'DUPLICATE') {
      logger.info(`[signup] result=DUPLICATE position=${outcome.position}`);
      sendJson(res, 200, {
        status: 'DUPLICATE',
        position: outcome.position,
        limit: store.limit,
        message: `你已报名，第 ${outcome.position} 位`,
      });
      return;
    }

    logger.info('[signup] result=FULL');
    sendJson(res, 409, {
      status: 'FULL',
      limit: store.limit,
      message: `报名已满（${store.limit}/${store.limit}）`,
    });
  }

  async function handleAdminLogin(req, res) {
    const parsed = await parseJsonBody(req, res);
    if (parsed === null) return;

    const outcome = auth.login(getClientKey(req), parsed.password);
    if (outcome.ok) {
      logger.info('[admin] login=SUCCESS');
      sendJson(
        res,
        200,
        { authenticated: true },
        { 'Set-Cookie': sessionCookie(outcome.token, isSecureRequest(req)) },
      );
      return;
    }

    logger.info(`[admin] login=${outcome.code}`);
    const extraHeaders = {};
    if (outcome.retryAfterSeconds) extraHeaders['Retry-After'] = String(outcome.retryAfterSeconds);
    sendError(res, outcome.status, outcome.code, outcome.message, extraHeaders);
  }

  function handleAdminList(req, res) {
    if (!requireAdmin(req, res)) return;

    const registrations = store.list().map((record) => ({
      position: record.position,
      name: record.name,
      employeeId: record.employeeId,
      department: record.department,
      registeredAt: formatShanghai(record.registeredAt),
    }));

    sendJson(res, 200, {
      total: store.count(),
      limit: store.limit,
      storage: 'memory',
      timezone: TIME_ZONE,
      registrations,
    });
  }

  function handleAdminExport(req, res) {
    if (!requireAdmin(req, res)) return;

    if (store.count() === 0) {
      sendError(res, 409, 'NO_REGISTRATIONS', '暂无报名可导出');
      return;
    }

    const records = store.list();
    const csv = buildCsv(records);
    const stamp = shanghaiFileStamp(nowDate());
    const downloadName = `技术分享会报名名单_当前实例_${stamp}.csv`;
    const asciiName = `signup-list-current-instance-${stamp}.csv`;
    const body = Buffer.from(csv, 'utf8');

    logger.info(`[admin] export count=${records.length}`);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Length': body.length,
      'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      'X-Export-Filename': encodeURIComponent(downloadName),
      'Cache-Control': 'no-store',
    });
    res.end(body);
  }

  async function handleApi(req, res, pathname) {
    if (pathname === '/api/health') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendError(res, 405, 'METHOD_NOT_ALLOWED', '方法不允许', { Allow: 'GET, HEAD' });
        return;
      }
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (pathname === '/api/status') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendError(res, 405, 'METHOD_NOT_ALLOWED', '方法不允许', { Allow: 'GET, HEAD' });
        return;
      }
      sendJson(res, 200, {
        total: store.count(),
        limit: store.limit,
        full: store.isFull(),
        timezone: TIME_ZONE,
        storage: 'memory',
      });
      return;
    }

    if (pathname === '/api/registrations') {
      if (req.method !== 'POST') {
        sendError(res, 405, 'METHOD_NOT_ALLOWED', '方法不允许', { Allow: 'POST' });
        return;
      }
      await handleRegister(req, res);
      return;
    }

    if (pathname === '/api/admin/login') {
      if (req.method !== 'POST') {
        sendError(res, 405, 'METHOD_NOT_ALLOWED', '方法不允许', { Allow: 'POST' });
        return;
      }
      await handleAdminLogin(req, res);
      return;
    }

    if (pathname === '/api/admin/registrations') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendError(res, 405, 'METHOD_NOT_ALLOWED', '方法不允许', { Allow: 'GET, HEAD' });
        return;
      }
      handleAdminList(req, res);
      return;
    }

    if (pathname === '/api/admin/export') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendError(res, 405, 'METHOD_NOT_ALLOWED', '方法不允许', { Allow: 'GET, HEAD' });
        return;
      }
      handleAdminExport(req, res);
      return;
    }

    sendError(res, 404, 'NOT_FOUND', '接口不存在');
  }

  async function handleStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
      return;
    }

    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      sendText(res, 404, 'Not Found');
      return;
    }
    if (decoded.includes('\0')) {
      sendText(res, 404, 'Not Found');
      return;
    }

    let relativePath;
    if (decoded === '/') relativePath = 'index.html';
    else if (decoded === '/admin' || decoded === '/admin/') relativePath = 'admin.html';
    else relativePath = decoded.replace(/^\/+/, '');

    const filePath = path.resolve(publicDir, relativePath);
    if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) {
      sendText(res, 404, 'Not Found');
      return;
    }

    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      sendText(res, 404, 'Not Found');
      return;
    }
    if (!stat.isFile()) {
      sendText(res, 404, 'Not Found');
      return;
    }

    let body;
    try {
      body = await fsp.readFile(filePath);
    } catch (error) {
      logger.error(`[static] 读取失败 ${path.basename(filePath)}：${error.message}`);
      sendText(res, 500, 'Internal Server Error');
      return;
    }

    const isHtml = path.extname(filePath).toLowerCase() === '.html';
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': isHtml ? 'no-store' : 'no-cache',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  return (req, res) => {
    const startedAt = process.hrtime.bigint();
    let pathname = '/';
    try {
      pathname = new URL(req.url || '/', 'http://localhost').pathname;
    } catch {
      pathname = '/';
    }

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger.info(`${req.method} ${pathname} ${res.statusCode} ${durationMs.toFixed(1)}ms`);
    });

    const run =
      pathname === '/api' || pathname.startsWith('/api/')
        ? handleApi(req, res, pathname)
        : handleStatic(req, res, pathname);

    Promise.resolve(run).catch((error) => {
      logger.error(`[server] 未捕获异常：${error.stack || error.message}`);
      if (!res.headersSent) {
        sendError(res, 500, 'INTERNAL_ERROR', '服务器内部错误，请稍后重试');
      } else {
        res.destroy();
      }
    });
  };
}

/** 创建 Node HTTP 服务（本地常驻进程使用）。 */
function createApp(options) {
  return http.createServer(createRequestHandler(options));
}

module.exports = { createApp, createRequestHandler, buildCsv, MIME_TYPES, SECURITY_HEADERS };
