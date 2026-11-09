# 技术分享会报名页

一个最小的报名页：表单、报名名单、工号去重、50 人上限。

## 运行

```bash
npm start     # http://localhost:3200
npm test
```

无第三方依赖，Node 18+。

## 接口

- `GET /api/signups` 报名名单
- `POST /api/signups` 提交报名（name / employeeId / department）
- `GET /api/health`

## 部署到 Vercel

仓库已按 Vercel 的零配置结构组织：

- `api/[...path].js`：Serverless 入口，承接所有 `/api/*` 请求
- `public/`：静态页面，`/` 直接打开 `public/index.html`

注意：数据存在进程内存里，Serverless 冷启动或换实例会丢数据，演示时不要依赖持久化。
