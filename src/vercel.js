'use strict';

const path = require('node:path');

const { createRequestHandler } = require('./app');
const { createRegistrationStore } = require('./store');

const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 8192);
const MAX_NAME_LENGTH = Number(process.env.MAX_NAME_LENGTH || 50);
const MAX_EMPLOYEE_ID_LENGTH = Number(process.env.MAX_EMPLOYEE_ID_LENGTH || 50);
const MAX_DEPARTMENT_LENGTH = Number(process.env.MAX_DEPARTMENT_LENGTH || 100);

/**
 * Vercel Serverless 入口。
 *
 * 同一函数实例复用同一份内存名单与管理员会话；冷启动、多实例或实例回收后
 * 名单会清空/不一致（Spec RISK-003，Demo 已确认可接受）。
 * 管理口令只从部署环境 ADMIN_PASSWORD 读取，不写入前端或仓库配置。
 */
function createVercelHandler() {
  let handler;

  function getHandler() {
    if (!handler) {
      const store = createRegistrationStore({ limit: 50 });
      handler = createRequestHandler({
        store,
        publicDir: path.join(__dirname, '..', 'public'),
        adminPassword: process.env.ADMIN_PASSWORD || '',
        maxBodyBytes: MAX_BODY_BYTES,
        maxName: MAX_NAME_LENGTH,
        maxEmployeeId: MAX_EMPLOYEE_ID_LENGTH,
        maxDepartment: MAX_DEPARTMENT_LENGTH,
      });
    }
    return handler;
  }

  return function vercelHandler(req, res) {
    try {
      return getHandler()(req, res);
    } catch (error) {
      console.error(`[vercel] 初始化失败：${error.stack || error.message}`);
      if (!res.headersSent) {
        const body = JSON.stringify({
          error: { code: 'INTERNAL_ERROR', message: '服务器内部错误，请稍后重试' },
        });
        res.writeHead(500, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(body),
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
        });
        res.end(body);
      } else {
        res.destroy();
      }
    }
  };
}

module.exports = { createVercelHandler };
