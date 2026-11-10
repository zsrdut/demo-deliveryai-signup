'use strict';

function cloneRecord(record) {
  return {
    position: record.position,
    name: record.name,
    employeeId: record.employeeId,
    department: record.department,
    registeredAt: record.registeredAt,
  };
}

/**
 * 报名名单内存存储。
 *
 * 名单只存在于当前运行实例；实例重启、冷启动或扩缩容会清空。
 * register() 是同步函数：工号查重、名额检查与位次分配在同一次调用中完成，
 * Node 单线程事件循环保证同一实例内不会出现交错写入（OQ-004）。
 */
function createRegistrationStore(options = {}) {
  const limit = options.limit ?? 50;
  const now = options.now || (() => new Date());
  /** @type {Array<{position:number,name:string,employeeId:string,department:string,registeredAt:string}>} */
  const records = [];
  const byEmployeeId = new Map();

  /**
   * @param {{name:string,employeeId:string,department:string}} input 已完成校验与 trim
   * @returns {{status:'SUCCESS',position:number,registration:object}
   *   | {status:'DUPLICATE',position:number}
   *   | {status:'FULL'}}
   */
  function register(input) {
    const existing = byEmployeeId.get(input.employeeId);
    if (existing) {
      return { status: 'DUPLICATE', position: existing.position };
    }
    if (records.length >= limit) {
      return { status: 'FULL' };
    }

    const registeredAt = now();
    const record = {
      position: records.length + 1,
      name: input.name,
      employeeId: input.employeeId,
      department: input.department,
      registeredAt: registeredAt instanceof Date ? registeredAt.toISOString() : new Date(registeredAt).toISOString(),
    };
    records.push(record);
    byEmployeeId.set(record.employeeId, record);
    return { status: 'SUCCESS', position: record.position, registration: cloneRecord(record) };
  }

  function list() {
    return records.map(cloneRecord);
  }

  function count() {
    return records.length;
  }

  function isFull() {
    return records.length >= limit;
  }

  return { limit, register, list, count, isFull };
}

module.exports = { createRegistrationStore };
