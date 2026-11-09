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
