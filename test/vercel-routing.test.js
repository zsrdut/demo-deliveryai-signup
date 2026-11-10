'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const configPath = path.join(__dirname, '..', 'vercel.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

/** 把 Vercel rewrite 的 source 语法（path-to-regexp 风格）转成等价正则。 */
function sourceToRegExp(source) {
  const escaped = source
    .split('(.*)')
    .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&'))
    .join('(.*)')
    .replace(/:([A-Za-z0-9_]+)/g, '([^/]+)');
  return new RegExp(`^${escaped}$`);
}

test('vercel.json 为嵌套 /api/* 路径提供重写，避免被平台直接 404', () => {
  const rewrites = Array.isArray(config.rewrites) ? config.rewrites : [];
  const apiRewrite = rewrites.find(
    (rule) =>
      typeof rule.source === 'string' &&
      /^\/api\//.test(rule.source) &&
      typeof rule.destination === 'string' &&
      rule.destination.startsWith('/api/[...path]')
  );

  assert.ok(
    apiRewrite,
    'vercel.json 缺少 /api/(.*) → /api/[...path] 重写：Vercel 零配置路由只匹配单段 /api/<x>，' +
      '/api/admin/registrations 等嵌套接口会被平台以 404 拦截，管理页将无法登录或读取名单'
  );

  const matcher = sourceToRegExp(apiRewrite.source);
  for (const nestedPath of [
    '/api/admin/registrations',
    '/api/admin/login',
    '/api/admin/export',
    '/api/health',
  ]) {
    assert.ok(matcher.test(nestedPath), `重写规则 ${apiRewrite.source} 未覆盖 ${nestedPath}`);
  }
});
