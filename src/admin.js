'use strict';

const crypto = require('node:crypto');

const DEFAULT_SESSION_IDLE_MS = 30 * 60 * 1000;
const DEFAULT_LOCK_MS = 10 * 60 * 1000;
const DEFAULT_MAX_FAILURES = 5;
const SESSION_COOKIE = 'signup_admin_session';

function digest(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest();
}

/**
 * 管理口令校验、会话与失败锁定。
 * 所有状态只存在于当前运行实例；口令来自部署环境，不写入前端。
 */
function createAdminAuth(options = {}) {
  const password = typeof options.password === 'string' ? options.password : '';
  const now = options.now || (() => Date.now());
  const sessionIdleMs = options.sessionIdleMs ?? DEFAULT_SESSION_IDLE_MS;
  const lockMs = options.lockMs ?? DEFAULT_LOCK_MS;
  const maxFailures = options.maxFailures ?? DEFAULT_MAX_FAILURES;
  const passwordDigest = password ? digest(password) : null;

  /** @type {Map<string, {lastActivity:number}>} */
  const sessions = new Map();
  /** @type {Map<string, {failures:number, lockedUntil:number, updatedAt:number}>} */
  const clients = new Map();

  function cleanup() {
    const current = now();
    for (const [token, session] of sessions) {
      if (current - session.lastActivity >= sessionIdleMs) sessions.delete(token);
    }
    for (const [key, entry] of clients) {
      if (entry.lockedUntil > current) continue;
      if (entry.lockedUntil > 0 || current - entry.updatedAt >= lockMs) clients.delete(key);
    }
  }

  /**
   * @param {string} clientKey 同一客户端标识（IP）
   * @param {unknown} candidate 用户输入的口令
   */
  function login(clientKey, candidate) {
    if (!passwordDigest) {
      return { ok: false, code: 'ADMIN_NOT_CONFIGURED', status: 503, message: '管理口令未配置，请联系管理员' };
    }

    cleanup();
    const current = now();
    const key = clientKey || 'unknown';
    const state = clients.get(key);

    if (state && state.lockedUntil > current) {
      return {
        ok: false,
        code: 'LOCKED',
        status: 429,
        retryAfterSeconds: Math.ceil((state.lockedUntil - current) / 1000),
        message: '口令错误次数过多，请 10 分钟后重试',
      };
    }
    if (state && state.lockedUntil > 0 && state.lockedUntil <= current) {
      clients.delete(key);
    }

    const candidateDigest = digest(typeof candidate === 'string' ? candidate : '');
    const granted = crypto.timingSafeEqual(passwordDigest, candidateDigest);

    if (!granted) {
      const entry = clients.get(key) || { failures: 0, lockedUntil: 0, updatedAt: current };
      entry.failures += 1;
      entry.updatedAt = current;
      if (entry.failures >= maxFailures) {
        entry.failures = 0;
        entry.lockedUntil = current + lockMs;
      }
      clients.set(key, entry);

      if (entry.lockedUntil > current) {
        return {
          ok: false,
          code: 'LOCKED',
          status: 429,
          retryAfterSeconds: Math.ceil((entry.lockedUntil - current) / 1000),
          message: '口令错误次数过多，请 10 分钟后重试',
        };
      }
      return { ok: false, code: 'INVALID_PASSWORD', status: 401, message: '口令错误，请重试' };
    }

    clients.delete(key);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { lastActivity: current });
    return { ok: true, token };
  }

  /** 校验会话；有效时刷新 30 分钟空闲计时。 */
  function authorize(token) {
    if (!token) return false;
    const session = sessions.get(token);
    if (!session) return false;
    const current = now();
    if (current - session.lastActivity >= sessionIdleMs) {
      sessions.delete(token);
      return false;
    }
    session.lastActivity = current;
    return true;
  }

  function revoke(token) {
    if (token) sessions.delete(token);
  }

  return { login, authorize, revoke, sessionIdleMs, lockMs, maxFailures };
}

module.exports = {
  SESSION_COOKIE,
  DEFAULT_SESSION_IDLE_MS,
  DEFAULT_LOCK_MS,
  DEFAULT_MAX_FAILURES,
  createAdminAuth,
};
