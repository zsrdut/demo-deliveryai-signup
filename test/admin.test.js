'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createAdminAuth } = require('../src/admin');

test('未配置管理口令时拒绝登录', () => {
  const auth = createAdminAuth({ password: '' });
  const result = auth.login('1.1.1.1', 'anything');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'ADMIN_NOT_CONFIGURED');
  assert.equal(result.status, 503);
});

test('连续 5 次错误口令后锁定 10 分钟，锁定期间正确口令也不放行', () => {
  let now = 0;
  const auth = createAdminAuth({ password: 's3cret', now: () => now });

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const result = auth.login('1.1.1.1', 'wrong');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'INVALID_PASSWORD');
  }

  const locked = auth.login('1.1.1.1', 'wrong');
  assert.equal(locked.ok, false);
  assert.equal(locked.code, 'LOCKED');
  assert.equal(locked.status, 429);
  assert.equal(locked.retryAfterSeconds, 600);

  now += 5 * 60 * 1000;
  const stillLocked = auth.login('1.1.1.1', 's3cret');
  assert.equal(stillLocked.ok, false);
  assert.equal(stillLocked.code, 'LOCKED');

  now += 5 * 60 * 1000;
  const unlocked = auth.login('1.1.1.1', 's3cret');
  assert.equal(unlocked.ok, true);
  assert.equal(typeof unlocked.token, 'string');
});

test('其他客户端不受锁定影响，成功登录会重置失败次数', () => {
  let now = 0;
  const auth = createAdminAuth({ password: 's3cret', now: () => now });

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    auth.login('1.1.1.1', 'wrong');
  }
  assert.equal(auth.login('2.2.2.2', 's3cret').ok, true);

  const success = auth.login('1.1.1.1', 's3cret');
  assert.equal(success.ok, true);

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const result = auth.login('1.1.1.1', 'wrong');
    assert.equal(result.code, 'INVALID_PASSWORD');
  }
});

test('管理会话 30 分钟无操作后过期，操作会刷新空闲计时', () => {
  let now = 0;
  const auth = createAdminAuth({ password: 's3cret', now: () => now });
  const login = auth.login('1.1.1.1', 's3cret');
  assert.equal(login.ok, true);

  now += 29 * 60 * 1000;
  assert.equal(auth.authorize(login.token), true);

  now += 29 * 60 * 1000;
  assert.equal(auth.authorize(login.token), true);

  now += 30 * 60 * 1000;
  assert.equal(auth.authorize(login.token), false);
});

test('撤销会话后不可继续访问', () => {
  const auth = createAdminAuth({ password: 's3cret', now: () => 0 });
  const login = auth.login('1.1.1.1', 's3cret');
  assert.equal(auth.authorize(login.token), true);
  auth.revoke(login.token);
  assert.equal(auth.authorize(login.token), false);
});
