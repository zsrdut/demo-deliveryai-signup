'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');

const { createRegistrationStore } = require('../src/store');
const { createApp } = require('../src/app');

const silentLogger = { info() {}, warn() {}, error() {} };
const SECRET = 's3cret';

async function startServer(t, options = {}) {
  const clock = { value: Date.parse('2026-11-09T06:00:00.000Z') };
  const store =
    options.store ||
    createRegistrationStore({
      limit: 50,
      now: () => new Date(clock.value),
    });

  const server = createApp({
    store,
    publicDir: path.join(__dirname, '..', 'public'),
    adminPassword: SECRET,
    logger: silentLogger,
    now: () => clock.value,
    ...options,
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  return { base, store, clock };
}

function postJson(base, pathname, body, headers = {}) {
  return fetch(`${base}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function login(base, password = SECRET, clientIp = '1.1.1.1') {
  const response = await postJson(
    base,
    '/api/admin/login',
    { password },
    { 'X-Forwarded-For': clientIp },
  );
  const body = await response.json();
  const setCookie = response.headers.get('set-cookie') || '';
  const match = /signup_admin_session=([^;]+)/.exec(setCookie);
  return {
    response,
    body,
    cookie: match ? `signup_admin_session=${match[1]}` : null,
  };
}

function adminGet(base, pathname, cookie) {
  return fetch(`${base}${pathname}`, {
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

function rawGet(base, rawPath) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: url.hostname, port: url.port, method: 'GET', path: rawPath },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('健康检查与初始报名状态', async (t) => {
  const { base } = await startServer(t);

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });

  const status = await fetch(`${base}/api/status`);
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), {
    total: 0,
    limit: 50,
    full: false,
    timezone: 'Asia/Shanghai',
    storage: 'memory',
  });
});

test('首位报名成功并返回位次 1', async (t) => {
  const { base, store } = await startServer(t);

  const response = await postJson(base, '/api/registrations', {
    name: ' 张三 ',
    employeeId: ' 1001 ',
    department: ' 研发 ',
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    status: 'SUCCESS',
    position: 1,
    limit: 50,
    message: '报名成功，你是第 1 位',
  });
  assert.equal(store.count(), 1);

  const status = await (await fetch(`${base}/api/status`)).json();
  assert.equal(status.total, 1);
  assert.equal(status.full, false);
});

test('连续报名返回位次 1、2、3，管理名单按位次升序', async (t) => {
  const { base } = await startServer(t);

  for (const employeeId of ['1001', '1002', '1003']) {
    const response = await postJson(base, '/api/registrations', {
      name: `员工${employeeId}`,
      employeeId,
      department: '研发',
    });
    assert.equal(response.status, 201);
  }

  const { cookie } = await login(base);
  assert.ok(cookie);

  const list = await adminGet(base, '/api/admin/registrations', cookie);
  assert.equal(list.status, 200);
  const body = await list.json();

  assert.equal(body.total, 3);
  assert.equal(body.limit, 50);
  assert.equal(body.storage, 'memory');
  assert.equal(body.timezone, 'Asia/Shanghai');
  assert.deepEqual(body.registrations.map((item) => item.position), [1, 2, 3]);
  assert.deepEqual(body.registrations[0], {
    position: 1,
    name: '员工1001',
    employeeId: '1001',
    department: '研发',
    registeredAt: '2026-11-09 14:00:00',
  });
});

test('字段缺失返回 400 且不写入名单', async (t) => {
  const { base, store } = await startServer(t);

  const response = await postJson(base, '/api/registrations', {
    name: '   ',
    employeeId: '',
    department: '研发',
  });

  assert.equal(response.status, 400);
  const body = await response.json();
  assert.equal(body.status, 'INVALID');
  assert.equal(body.errors.name.code, 'NAME_REQUIRED');
  assert.equal(body.errors.employeeId.code, 'EMPLOYEE_ID_REQUIRED');
  assert.equal(body.errors.department, undefined);
  assert.equal(store.count(), 0);
});

test('工号去首尾空格、区分大小写，部门仅去首尾空格', async (t) => {
  const { base } = await startServer(t);

  const first = await postJson(base, '/api/registrations', {
    name: '张三',
    employeeId: ' A001 ',
    department: ' 研发 中心 ',
  });
  assert.equal(first.status, 201);
  assert.equal((await first.json()).position, 1);

  const lower = await postJson(base, '/api/registrations', {
    name: '张三',
    employeeId: 'a001',
    department: '研发',
  });
  assert.equal(lower.status, 201);
  assert.equal((await lower.json()).position, 2);

  const duplicate = await postJson(base, '/api/registrations', {
    name: '李四',
    employeeId: 'A001',
    department: '市场',
  });
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await duplicate.json(), {
    status: 'DUPLICATE',
    position: 1,
    limit: 50,
    message: '你已报名，第 1 位',
  });

  const { cookie } = await login(base);
  const list = await (await adminGet(base, '/api/admin/registrations', cookie)).json();
  assert.equal(list.total, 2);
  assert.equal(list.registrations[0].name, '张三');
  assert.equal(list.registrations[0].department, '研发 中心');
});

test('第 50 人成功，第 51 人满额；满额后重复工号仍返回原位次', async (t) => {
  const { base, store, clock } = await startServer(t);
  for (let index = 1; index <= 49; index += 1) {
    store.register({ name: `员工${index}`, employeeId: `E${index}`, department: '研发' });
  }

  const fiftieth = await postJson(base, '/api/registrations', {
    name: '第五十',
    employeeId: 'E50',
    department: '研发',
  });
  assert.equal(fiftieth.status, 201);
  assert.equal((await fiftieth.json()).position, 50);

  const rejected = await postJson(base, '/api/registrations', {
    name: '第五十一',
    employeeId: 'E51',
    department: '研发',
  });
  assert.equal(rejected.status, 409);
  assert.deepEqual(await rejected.json(), {
    status: 'FULL',
    limit: 50,
    message: '报名已满（50/50）',
  });
  assert.equal(store.count(), 50);

  const duplicate = await postJson(base, '/api/registrations', {
    name: '第五十',
    employeeId: 'E50',
    department: '研发',
  });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).status, 'DUPLICATE');

  const status = await (await fetch(`${base}/api/status`)).json();
  assert.equal(status.total, 50);
  assert.equal(status.full, true);
  assert.ok(Number.isFinite(clock.value));
});

test('同工号 10 个并发请求只产生 1 条记录与位次 1', async (t) => {
  const { base, store } = await startServer(t);

  const responses = await Promise.all(
    Array.from({ length: 10 }, () =>
      postJson(base, '/api/registrations', {
        name: '张三',
        employeeId: '1001',
        department: '研发',
      }),
    ),
  );
  const bodies = await Promise.all(responses.map((response) => response.json()));

  assert.equal(store.count(), 1);
  assert.equal(responses.filter((response) => response.status === 201).length, 1);
  assert.equal(responses.filter((response) => response.status === 200).length, 9);
  assert.deepEqual([...new Set(bodies.map((body) => body.position))], [1]);
});

test('竞争最后 1 个名额时恰好 1 人成功，其余返回满额', async (t) => {
  const { base, store } = await startServer(t);
  for (let index = 1; index <= 49; index += 1) {
    store.register({ name: `员工${index}`, employeeId: `E${index}`, department: '研发' });
  }

  const responses = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      postJson(base, '/api/registrations', {
        name: `后来者${index}`,
        employeeId: `LATE${index}`,
        department: '研发',
      }),
    ),
  );
  const bodies = await Promise.all(responses.map((response) => response.json()));
  const successes = bodies.filter((body) => body.status === 'SUCCESS');

  assert.equal(store.count(), 50);
  assert.equal(successes.length, 1);
  assert.equal(successes[0].position, 50);
  assert.equal(bodies.filter((body) => body.status === 'FULL').length, 9);
});

test('未授权访问管理名单与导出均被拒绝', async (t) => {
  const { base } = await startServer(t);

  const list = await fetch(`${base}/api/admin/registrations`);
  assert.equal(list.status, 401);
  assert.equal((await list.json()).error.code, 'UNAUTHORIZED');

  const exported = await fetch(`${base}/api/admin/export`);
  assert.equal(exported.status, 401);
  assert.equal((await exported.json()).error.code, 'UNAUTHORIZED');

  const bogus = await adminGet(base, '/api/admin/registrations', 'signup_admin_session=bogus');
  assert.equal(bogus.status, 401);
});

test('错误口令返回 401，正确口令建立 HttpOnly 会话', async (t) => {
  const { base } = await startServer(t);

  const wrong = await login(base, 'wrong');
  assert.equal(wrong.response.status, 401);
  assert.equal(wrong.body.error.code, 'INVALID_PASSWORD');
  assert.equal(wrong.body.error.message, '口令错误，请重试');
  assert.equal(wrong.cookie, null);

  const correct = await login(base);
  assert.equal(correct.response.status, 200);
  assert.deepEqual(correct.body, { authenticated: true });
  assert.ok(correct.cookie);
  const setCookie = correct.response.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
});

test('未配置管理口令时登录返回 503', async (t) => {
  const { base } = await startServer(t, { adminPassword: '' });
  const response = await login(base);
  assert.equal(response.response.status, 503);
  assert.equal(response.body.error.code, 'ADMIN_NOT_CONFIGURED');
});

test('同一客户端连续 5 次错误口令后锁定 10 分钟', async (t) => {
  const { base, clock } = await startServer(t);

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const result = await login(base, 'wrong', '9.9.9.9');
    assert.equal(result.response.status, 401);
  }

  const locked = await login(base, 'wrong', '9.9.9.9');
  assert.equal(locked.response.status, 429);
  assert.equal(locked.body.error.code, 'LOCKED');
  assert.match(locked.body.error.message, /10 分钟后重试/);

  const blockedCorrect = await login(base, SECRET, '9.9.9.9');
  assert.equal(blockedCorrect.response.status, 429);

  const otherClient = await login(base, SECRET, '8.8.8.8');
  assert.equal(otherClient.response.status, 200);

  clock.value += 10 * 60 * 1000;
  const afterLock = await login(base, SECRET, '9.9.9.9');
  assert.equal(afterLock.response.status, 200);
});

test('管理会话 30 分钟无操作后失效', async (t) => {
  const { base, clock } = await startServer(t);
  const { response, cookie } = await login(base);
  assert.equal(response.status, 200);

  clock.value += 29 * 60 * 1000;
  assert.equal((await adminGet(base, '/api/admin/registrations', cookie)).status, 200);

  clock.value += 30 * 60 * 1000;
  const expired = await adminGet(base, '/api/admin/registrations', cookie);
  assert.equal(expired.status, 401);
  assert.equal((await expired.json()).error.code, 'UNAUTHORIZED');
});

test('导出 CSV 使用 UTF-8 BOM、固定列顺序与上海时区时间', async (t) => {
  const { base, clock } = await startServer(t);

  clock.value = Date.parse('2026-11-09T06:00:00.000Z');
  await postJson(base, '/api/registrations', {
    name: '张三',
    employeeId: '1001',
    department: '研发',
  });

  clock.value = Date.parse('2026-11-09T06:01:00.000Z');
  await postJson(base, '/api/registrations', {
    name: '李四',
    employeeId: '1002',
    department: '市场',
  });

  clock.value = Date.parse('2026-11-09T15:07:00.000Z');
  const { cookie } = await login(base);
  const response = await adminGet(base, '/api/admin/export', cookie);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/csv/);
  assert.match(response.headers.get('content-disposition'), /attachment/);
  assert.match(response.headers.get('content-disposition'), /filename\*=UTF-8''/);

  const expectedName = '技术分享会报名名单_当前实例_20261109-2307.csv';
  assert.equal(decodeURIComponent(response.headers.get('x-export-filename')), expectedName);
  assert.equal(response.headers.get('cache-control'), 'no-store');

  const buffer = Buffer.from(await response.arrayBuffer());
  assert.deepEqual([...buffer.subarray(0, 3)], [0xef, 0xbb, 0xbf]);

  const text = buffer.toString('utf8');
  assert.ok(text.startsWith('\uFEFF位次,姓名,工号,部门,报名时间\r\n'));
  assert.ok(text.includes('1,张三,1001,研发,2026-11-09 14:00:00\r\n'));
  assert.ok(text.includes('2,李四,1002,市场,2026-11-09 14:01:00\r\n'));
  assert.ok(text.indexOf('1,张三') < text.indexOf('2,李四'));
  assert.equal(response.headers.get('location'), null);
});

test('CSV 导出对公式前缀做文本化转义', async (t) => {
  const { base } = await startServer(t);
  await postJson(base, '/api/registrations', {
    name: '=SUM(A1)',
    employeeId: '+1001',
    department: '@研发',
  });

  const { cookie } = await login(base);
  const response = await adminGet(base, '/api/admin/export', cookie);
  const text = Buffer.from(await response.arrayBuffer()).toString('utf8');
  assert.ok(text.includes("1,'=SUM(A1),'+1001,'@研发,"));
});

test('空名单导出返回 409 且不生成文件', async (t) => {
  const { base } = await startServer(t);
  const { cookie } = await login(base);

  const response = await adminGet(base, '/api/admin/export', cookie);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'NO_REGISTRATIONS');
  assert.equal(response.headers.get('content-disposition'), null);
});

test('报名响应不包含其他报名者信息', async (t) => {
  const { base } = await startServer(t);

  await postJson(base, '/api/registrations', {
    name: '已有报名者',
    employeeId: '1001',
    department: '研发',
  });
  const response = await postJson(base, '/api/registrations', {
    name: '新报名者',
    employeeId: '1002',
    department: '市场',
  });
  const body = await response.json();

  assert.deepEqual(Object.keys(body).sort(), ['limit', 'message', 'position', 'status']);
  assert.equal(JSON.stringify(body).includes('已有报名者'), false);
});

test('报名页与管理页可访问，报名页不暴露管理入口', async (t) => {
  const { base } = await startServer(t);

  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /text\/html/);
  const html = await index.text();
  assert.match(html, /技术分享会/);
  assert.match(html, /11 月底 14:00/);
  assert.match(html, /三层报告厅/);
  assert.match(html, /报名限 50 人/);
  assert.match(html, /\/app\.js/);
  assert.equal(html.includes('/admin'), false);

  const admin = await fetch(`${base}/admin`);
  assert.equal(admin.status, 200);
  const adminHtml = await admin.text();
  assert.match(adminHtml, /请输入管理口令/);
  assert.match(adminHtml, /本系统使用内存存储，实例重启\/切换会清空名单/);
  assert.match(adminHtml, /\/admin\.js/);

  const script = await fetch(`${base}/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);

  const style = await fetch(`${base}/styles.css`);
  assert.equal(style.status, 200);
  assert.match(style.headers.get('content-type'), /text\/css/);
});

test('页面与接口带基础安全响应头', async (t) => {
  const { base } = await startServer(t);

  const page = await fetch(`${base}/`);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(page.headers.get('cache-control'), 'no-store');

  const status = await fetch(`${base}/api/status`);
  assert.equal(status.headers.get('cache-control'), 'no-store');
  assert.equal(status.headers.get('x-content-type-options'), 'nosniff');
});

test('非法 JSON、数组请求体与超大请求体被拒绝', async (t) => {
  const { base, store } = await startServer(t, { maxBodyBytes: 1024 });

  const broken = await postJson(base, '/api/registrations', '{ broken');
  assert.equal(broken.status, 400);
  assert.equal((await broken.json()).error.code, 'INVALID_JSON');

  const array = await postJson(base, '/api/registrations', '[1,2,3]');
  assert.equal(array.status, 400);
  assert.equal((await array.json()).error.code, 'INVALID_JSON');

  const huge = await postJson(base, '/api/registrations', {
    name: '张三',
    employeeId: '1001',
    department: 'a'.repeat(2000),
  });
  assert.equal(huge.status, 413);
  assert.equal((await huge.json()).error.code, 'PAYLOAD_TOO_LARGE');
  assert.equal(store.count(), 0);
});

test('方法不允许、未知接口与路径穿越按预期处理', async (t) => {
  const { base } = await startServer(t);

  const method = await fetch(`${base}/api/registrations`);
  assert.equal(method.status, 405);
  assert.equal(method.headers.get('allow'), 'POST');
  assert.equal((await method.json()).error.code, 'METHOD_NOT_ALLOWED');

  const unknown = await fetch(`${base}/api/unknown`);
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error.code, 'NOT_FOUND');

  for (const rawPath of ['/../server.js', '/%2e%2e/server.js', '/%2e%2e%2fserver.js']) {
    const response = await rawGet(base, rawPath);
    assert.equal(response.statusCode, 404, rawPath);
  }
});
