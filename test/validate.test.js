'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateRegistrationInput, codePointLength } = require('../src/validate');

test('去除首尾空格，保留部门内部空格与工号大小写', () => {
  const result = validateRegistrationInput({
    name: ' 张三 ',
    employeeId: ' A-001 ',
    department: ' 研发 中心 ',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    name: '张三',
    employeeId: 'A-001',
    department: '研发 中心',
  });
});

test('三个字段分别必填，空字符串与纯空格都拒绝', () => {
  const cases = [
    [{ name: ' ', employeeId: '1001', department: '研发' }, 'name', 'NAME_REQUIRED'],
    [{ name: '张三', employeeId: '   ', department: '研发' }, 'employeeId', 'EMPLOYEE_ID_REQUIRED'],
    [{ name: '张三', employeeId: '1001', department: '' }, 'department', 'DEPARTMENT_REQUIRED'],
  ];

  for (const [payload, field, code] of cases) {
    const result = validateRegistrationInput(payload);
    assert.equal(result.ok, false);
    assert.equal(result.errors[field].code, code);
    assert.equal(typeof result.errors[field].message, 'string');
  }
});

test('超过长度上限时按字段返回错误', () => {
  const tooLongName = validateRegistrationInput({
    name: '名'.repeat(51),
    employeeId: '1001',
    department: '研发',
  });
  assert.equal(tooLongName.ok, false);
  assert.equal(tooLongName.errors.name.code, 'NAME_TOO_LONG');

  const tooLongId = validateRegistrationInput({
    name: '张三',
    employeeId: '1'.repeat(51),
    department: '研发',
  });
  assert.equal(tooLongId.ok, false);
  assert.equal(tooLongId.errors.employeeId.code, 'EMPLOYEE_ID_TOO_LONG');

  const tooLongDepartment = validateRegistrationInput({
    name: '张三',
    employeeId: '1001',
    department: '部'.repeat(101),
  });
  assert.equal(tooLongDepartment.ok, false);
  assert.equal(tooLongDepartment.errors.department.code, 'DEPARTMENT_TOO_LONG');
});

test('长度按 Unicode 码点计数，emoji 计为 1', () => {
  const result = validateRegistrationInput({
    name: '😀'.repeat(50),
    employeeId: '😀'.repeat(50),
    department: '😀'.repeat(100),
  });
  assert.equal(result.ok, true);
  assert.equal(codePointLength(result.value.name), 50);
});

test('工号不做格式校验、不转大写、不做 Unicode 归一化', () => {
  const result = validateRegistrationInput({
    name: '张三',
    employeeId: ' a-００1 ',
    department: '研发',
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.employeeId, 'a-００1');
});

test('非字符串字段按空值处理，未知字段被忽略', () => {
  const result = validateRegistrationInput({
    name: 123,
    employeeId: null,
    department: ['研发'],
    extra: 'ignored',
  });
  assert.equal(result.ok, false);
  assert.equal(result.errors.name.code, 'NAME_REQUIRED');
  assert.equal(result.errors.employeeId.code, 'EMPLOYEE_ID_REQUIRED');
  assert.equal(result.errors.department.code, 'DEPARTMENT_REQUIRED');
});
