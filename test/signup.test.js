const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { createServer } = require('../src/app');
const store = require('../src/store');

let server;
let base;

beforeEach(async () => {
  store.reset();
  server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(() => server.close());

async function post(body) {
  const res = await fetch(`${base}/api/signups`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, data: await res.json() };
}

test('断言 1：合法报名返回 201，并出现在名单中', async () => {
  const res = await post({ name: '张三', employeeId: 'A001', department: '基础架构' });
  assert.strictEqual(res.status, 201);
  assert.strictEqual(res.data.seq, 1);
});

test('断言 2：同一工号重复报名返回 409，人数不变', async () => {
  await post({ name: '张三', employeeId: 'A001', department: '基础架构' });
  const res = await post({ name: '张三', employeeId: 'A001', department: '基础架构' });
  assert.strictEqual(res.status, 409);
  const listRes = await fetch(`${base}/api/signups`);
  const list = await listRes.json();
  assert.strictEqual(list.total, 1);
});

test('断言 3：缺少必填字段返回 400', async () => {
  const res = await post({ name: '张三', employeeId: '', department: '基础架构' });
  assert.strictEqual(res.status, 400);
});

test('断言 4：超过 50 人后返回 409', async () => {
  for (let i = 1; i <= 50; i += 1) {
    const res = await post({ name: `用户${i}`, employeeId: `A${i}`, department: '研发' });
    assert.strictEqual(res.status, 201);
  }
  const res = await post({ name: '第51人', employeeId: 'A51', department: '研发' });
  assert.strictEqual(res.status, 409);
});
