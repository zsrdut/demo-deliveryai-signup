'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { formatShanghai, shanghaiFileStamp } = require('../src/time');

test('按 Asia/Shanghai 输出 YYYY-MM-DD HH:mm:ss', () => {
  assert.equal(formatShanghai('2026-11-09T06:05:07.000Z'), '2026-11-09 14:05:07');
});

test('跨日边界按上海时区换日', () => {
  assert.equal(formatShanghai('2026-11-09T16:00:00.000Z'), '2026-11-10 00:00:00');
});

test('导出文件名时间戳按上海时区输出 YYYYMMDD-HHmm', () => {
  assert.equal(shanghaiFileStamp('2026-11-09T15:07:00.000Z'), '20261109-2307');
});

test('非法时间返回空字符串', () => {
  assert.equal(formatShanghai('not-a-date'), '');
  assert.equal(shanghaiFileStamp('not-a-date'), '');
});
