'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createRegistrationStore } = require('../src/store');

function input(employeeId, overrides = {}) {
  return {
    name: '张三',
    employeeId,
    department: '研发',
    ...overrides,
  };
}

test('位次从 1 开始连续递增', () => {
  const store = createRegistrationStore();
  assert.equal(store.register(input('1001')).position, 1);
  assert.equal(store.register(input('1002')).position, 2);
  assert.equal(store.register(input('1003')).position, 3);
  assert.deepEqual(store.list().map((item) => item.position), [1, 2, 3]);
});

test('最多 50 条，第 51 条返回 FULL 且不新增', () => {
  const store = createRegistrationStore({ limit: 50 });
  for (let index = 1; index <= 50; index += 1) {
    assert.equal(store.register(input(`E${index}`)).status, 'SUCCESS');
  }
  assert.equal(store.count(), 50);
  assert.equal(store.isFull(), true);
  assert.deepEqual(store.register(input('E51')), { status: 'FULL' });
  assert.equal(store.count(), 50);
});

test('重复工号返回原位次且不覆盖原记录', () => {
  const times = [
    new Date('2026-11-09T06:00:00.000Z'),
    new Date('2026-11-09T07:00:00.000Z'),
  ];
  let index = 0;
  const store = createRegistrationStore({ now: () => times[index++] });

  const first = store.register(input('1001', { name: '张三', department: '研发' }));
  assert.equal(first.position, 1);
  const duplicate = store.register(input('1001', { name: '李四', department: '市场' }));

  assert.equal(duplicate.status, 'DUPLICATE');
  assert.equal(duplicate.position, 1);
  assert.equal(store.count(), 1);
  assert.deepEqual(store.list()[0], {
    position: 1,
    name: '张三',
    employeeId: '1001',
    department: '研发',
    registeredAt: '2026-11-09T06:00:00.000Z',
  });
});

test('工号区分大小写，A001 与 a001 是不同记录', () => {
  const store = createRegistrationStore();
  assert.equal(store.register(input('A001')).position, 1);
  assert.equal(store.register(input('a001')).position, 2);
  assert.equal(store.count(), 2);
});

test('满额后重复工号仍返回原位次而不是 FULL', () => {
  const store = createRegistrationStore({ limit: 2 });
  store.register(input('1001'));
  store.register(input('1002'));

  const duplicate = store.register(input('1001'));
  assert.equal(duplicate.status, 'DUPLICATE');
  assert.equal(duplicate.position, 1);
  assert.equal(store.register(input('1003')).status, 'FULL');
});

test('同工号并发 10 次只创建 1 条并共用位次 1', async () => {
  const store = createRegistrationStore();
  const results = await Promise.all(
    Array.from({ length: 10 }, () => Promise.resolve().then(() => store.register(input('1001')))),
  );

  assert.equal(store.count(), 1);
  assert.equal(results.filter((item) => item.status === 'SUCCESS').length, 1);
  assert.equal(results.filter((item) => item.status === 'DUPLICATE').length, 9);
  assert.deepEqual([...new Set(results.map((item) => item.position))], [1]);
});

test('竞争最后 1 个名额时恰好 1 人成功，其余 FULL', async () => {
  const store = createRegistrationStore({ limit: 50 });
  for (let index = 1; index <= 49; index += 1) {
    store.register(input(`E${index}`));
  }

  const results = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      Promise.resolve().then(() => store.register(input(`LATE${index}`))),
    ),
  );

  assert.equal(store.count(), 50);
  assert.equal(results.filter((item) => item.status === 'SUCCESS').length, 1);
  assert.equal(results.filter((item) => item.status === 'FULL').length, 9);
  assert.equal(results.find((item) => item.status === 'SUCCESS').position, 50);
});
