'use strict';

const path = require('node:path');

const { createApp } = require('./src/app');
const { createRegistrationStore } = require('./src/store');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES || 8192);
const MAX_NAME_LENGTH = Number(process.env.MAX_NAME_LENGTH || 50);
const MAX_EMPLOYEE_ID_LENGTH = Number(process.env.MAX_EMPLOYEE_ID_LENGTH || 50);
const MAX_DEPARTMENT_LENGTH = Number(process.env.MAX_DEPARTMENT_LENGTH || 100);

function main() {
  const store = createRegistrationStore({ limit: 50 });
  const server = createApp({
    store,
    publicDir: path.join(__dirname, 'public'),
    adminPassword: ADMIN_PASSWORD,
    maxBodyBytes: MAX_BODY_BYTES,
    maxName: MAX_NAME_LENGTH,
    maxEmployeeId: MAX_EMPLOYEE_ID_LENGTH,
    maxDepartment: MAX_DEPARTMENT_LENGTH,
  });

  server.listen(PORT, HOST, () => {
    console.log(`[server] 技术分享会报名页已启动 http://${HOST}:${PORT}`);
    if (!ADMIN_PASSWORD) {
      console.warn('[server] 未配置 ADMIN_PASSWORD，管理页登录已禁用；报名页仍可正常使用');
    }
    console.log('[server] 名单仅保存在当前运行实例内存中，重启/实例切换会清空');
  });

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] 收到 ${signal}，停止接收新连接…`);
    server.close(() => {
      console.log('[server] 进程退出');
      process.exit(0);
    });
    const timer = setTimeout(() => process.exit(1), 6000);
    timer.unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
