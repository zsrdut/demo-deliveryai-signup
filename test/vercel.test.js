'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const { createVercelHandler } = require('../src/vercel');

test('Vercel handler 复用路由并共享同一实例内存名单', async (t) => {
  const previousPassword = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = 's3cret';
  t.after(() => {
    if (previousPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previousPassword;
  });

  const server = http.createServer(createVercelHandler());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const base = `http://127.0.0.1:${server.address().port}`;

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const created = await fetch(`${base}/api/registrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Vercel', employeeId: 'V001', department: '研发' }),
  });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).position, 1);

  const status = await fetch(`${base}/api/status`);
  assert.equal((await status.json()).total, 1);

  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 's3cret' }),
  });
  assert.equal(login.status, 200);
  const cookie = /signup_admin_session=([^;]+)/.exec(login.headers.get('set-cookie'))[1];

  const list = await fetch(`${base}/api/admin/registrations`, {
    headers: { Cookie: `signup_admin_session=${cookie}` },
  });
  assert.equal(list.status, 200);
  const listBody = await list.json();
  assert.equal(listBody.total, 1);
  assert.equal(listBody.registrations[0].employeeId, 'V001');

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /技术分享会报名/);
});
