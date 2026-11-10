'use strict';

const DEFAULT_MAX_NAME = 50;
const DEFAULT_MAX_EMPLOYEE_ID = 50;
const DEFAULT_MAX_DEPARTMENT = 100;

/** 按 Unicode 码点计数，emoji 计为 1，前后端口径一致。 */
function codePointLength(value) {
  return Array.from(value).length;
}

const FIELDS = [
  { key: 'name', label: '姓名', code: 'NAME', maxKey: 'maxName', defaultMax: DEFAULT_MAX_NAME },
  { key: 'employeeId', label: '工号', code: 'EMPLOYEE_ID', maxKey: 'maxEmployeeId', defaultMax: DEFAULT_MAX_EMPLOYEE_ID },
  { key: 'department', label: '部门', code: 'DEPARTMENT', maxKey: 'maxDepartment', defaultMax: DEFAULT_MAX_DEPARTMENT },
];

/**
 * 校验并归一化报名字段。
 * - 三个字段都只去除首尾空格；部门内部空格保留。
 * - 工号不做格式、大小写或 Unicode 归一化，按剩余原字符串参与唯一性比较。
 * @param {unknown} input 原始请求体
 * @param {{maxName?: number, maxEmployeeId?: number, maxDepartment?: number}} [limits]
 */
function validateRegistrationInput(input, limits = {}) {
  const source = input !== null && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const value = {};
  const errors = {};

  for (const field of FIELDS) {
    const max = limits[field.maxKey] ?? field.defaultMax;
    const raw = source[field.key];
    const text = typeof raw === 'string' ? raw.trim() : '';

    if (!text) {
      errors[field.key] = {
        code: `${field.code}_REQUIRED`,
        message: `请输入${field.label}`,
      };
      continue;
    }
    if (codePointLength(text) > max) {
      errors[field.key] = {
        code: `${field.code}_TOO_LONG`,
        message: `${field.label}最多 ${max} 字`,
      };
      continue;
    }
    value[field.key] = text;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value };
}

module.exports = {
  DEFAULT_MAX_NAME,
  DEFAULT_MAX_EMPLOYEE_ID,
  DEFAULT_MAX_DEPARTMENT,
  codePointLength,
  validateRegistrationInput,
};
