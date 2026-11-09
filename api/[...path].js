// Vercel Serverless 入口：把 /api/* 的请求交给同一个 handler。
// 本地仍用 server.js 起常驻服务；两者路由逻辑一致。
const { handler } = require('../src/app');

module.exports = (req, res) => handler(req, res);
