'use strict';

const TIME_ZONE = 'Asia/Shanghai';

const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function toDate(value) {
  return value instanceof Date ? value : new Date(value);
}

/** 按 Asia/Shanghai (UTC+8) 输出 YYYY-MM-DD HH:mm:ss。 */
function formatShanghai(value) {
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** 按 Asia/Shanghai 输出导出文件名时间戳 YYYYMMDD-HHmm。 */
function shanghaiFileStamp(value) {
  const text = formatShanghai(value);
  if (!text) return '';
  return `${text.slice(0, 10).replace(/-/g, '')}-${text.slice(11, 16).replace(':', '')}`;
}

module.exports = { TIME_ZONE, formatShanghai, shanghaiFileStamp };
