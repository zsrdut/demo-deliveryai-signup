// 演示用内存存储：重启即重置，不接数据库。
const MAX_SIGNUPS = 50;
const signups = [];

function reset() {
  signups.length = 0;
}

function list() {
  return signups;
}

function findByEmployeeId(employeeId) {
  return signups.find((s) => s.employeeId === employeeId);
}

function isFull() {
  return signups.length >= MAX_SIGNUPS;
}

function add({ name, employeeId, department }) {
  const item = {
    seq: signups.length + 1,
    name: name.trim(),
    employeeId: employeeId.trim(),
    department: department.trim(),
    at: new Date().toISOString()
  };
  signups.push(item);
  return item;
}

module.exports = { MAX_SIGNUPS, reset, list, findByEmployeeId, isFull, add };
