# 技术分享会报名页

面向 11 月底技术分享会的线上报名页：参与者填写姓名、工号、部门后获得当前运行实例内的唯一位次；行政人员凭管理口令查看完整名单并导出 CSV。

- 单进程 Node.js 服务，同时提供静态页面与 JSON 接口
- 零第三方运行时依赖，Node.js >= 20，`npm start` 即可运行（无需 `npm install` 安装依赖）
- 名单只保存在当前运行实例的内存中，不做持久化（演示环境约定）
- 前端原生 HTML/CSS/JS，无构建步骤

## 页面与入口

| 路径 | 访问者 | 说明 |
|------|--------|------|
| `/` | 参与者 | 会务信息、报名表单、位次结果与满额状态 |
| `/admin` | 行政 | 口令登录后查看当前实例名单并导出 CSV；报名页不暴露该入口 |

会务信息固定展示为：主题“技术分享会”、时间“11 月底 14:00”、地点“三层报告厅”。不得自行补写具体日期。

## 快速开始

要求 Node.js >= 20（开发环境使用 v22）。

```bash
ADMIN_PASSWORD='请替换为线下告知行政的口令' npm start
# 打开 http://localhost:3000
```

自定义端口：

```bash
PORT=8080 ADMIN_PASSWORD='...' npm start
```

运行测试：

```bash
npm test
```

未配置 `ADMIN_PASSWORD` 时报名页仍可使用，但管理页登录会返回 503（管理口令未配置），避免使用弱默认口令。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | HTTP 监听端口（本地常驻进程） |
| `HOST` | `0.0.0.0` | 监听地址（本地常驻进程） |
| `ADMIN_PASSWORD` | 空 | 管理口令，由部署环境注入；为空时管理页登录禁用 |
| `MAX_BODY_BYTES` | `8192` | 请求体上限（字节） |
| `MAX_NAME_LENGTH` | `50` | 姓名最大长度（Unicode 码点） |
| `MAX_EMPLOYEE_ID_LENGTH` | `50` | 工号最大长度（Unicode 码点） |
| `MAX_DEPARTMENT_LENGTH` | `100` | 部门最大长度（Unicode 码点） |

> 修改长度上限时，需同步修改 `public/app.js` 顶部的 `MAX_NAME` / `MAX_EMPLOYEE_ID` / `MAX_DEPARTMENT` 常量，保证前后端提示一致。

## 业务规则

- 报名上限固定 50 人；第 50 条成功，第 51 条起返回满额且不新增记录。
- 位次按有效记录写入顺序从 1 开始递增，唯一、连续，不支持取消或重排。
- 工号仅去除首尾空格，按剩余原字符串精确比较且区分大小写；不做数字/格式校验、不转大写、不做 Unicode 归一化。
- 同工号重复提交返回“已报名 + 原位次”，不占新名额、不覆盖原姓名/部门/报名时间。
- 姓名、工号、部门均必填；部门为单行文本框，仅去除首尾空格，保留内部空格。
- 报名时间统一按 `Asia/Shanghai (UTC+8)` 展示为 `YYYY-MM-DD HH:mm:ss`。

## 内部接口

所有接口只作用于收到请求的运行实例，不提供跨实例或持久化能力。

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/health` | GET | 健康检查，返回 `{ "status": "ok" }` |
| `/api/status` | GET | 当前实例报名总数、上限、是否满额 |
| `/api/registrations` | POST | 提交报名，请求 `{ "name": string, "employeeId": string, "department": string }` |
| `/api/admin/login` | POST | 校验管理口令并建立 30 分钟空闲会话 |
| `/api/admin/registrations` | GET | 需管理会话；返回当前实例名单与总数 |
| `/api/admin/export` | GET | 需管理会话；返回 CSV 文件；空名单时返回 409 |

报名响应类别：

| HTTP | `status` | 含义 |
|------|----------|------|
| 201 | `SUCCESS` | 报名成功，返回 `position` |
| 200 | `DUPLICATE` | 同工号已报名，返回原位次 |
| 409 | `FULL` | 当前实例已满 50 人 |
| 400 | `INVALID` | 字段校验失败，`errors` 按字段返回 |
| 401/429/503 | — | 管理口令错误 / 连续 5 次错误锁定 10 分钟 / 未配置口令 |
| 500 | — | 服务端异常，可重试 |

错误响应统一为 `{ "error": { "code": string, "message": string } }`（字段校验为 `status: "INVALID"` + `errors`）。

## 导出格式

- CSV，UTF-8 BOM，CRLF 换行，常见表格软件可直接打开中文
- 列顺序：位次、姓名、工号、部门、报名时间
- 文件名：`技术分享会报名名单_当前实例_YYYYMMDD-HHmm.csv`（时间为 `Asia/Shanghai`）
- 仅通过有效管理会话下载，不生成公开链接
- 以 `=`、`+`、`-`、`@` 开头的文本单元格会加单引号前缀，避免表格软件把用户输入当作公式执行
- 导出文件含个人信息，行政需在活动结束后 7 个自然日内删除，不得公开转发

## 权限与安全

- 管理口令只在服务端从 `ADMIN_PASSWORD` 读取，不写入页面源码、URL 或仓库配置
- 管理会话使用 `HttpOnly`、`SameSite=Lax` Cookie；30 分钟无操作过期
- 同一客户端连续 5 次错误口令锁定 10 分钟，锁定期间正确口令也不放行
- 名单与导出接口均在服务端校验会话，参与者页面与报名响应不包含其他报名者信息
- 页面与接口带 CSP、`X-Content-Type-Options`、`Referrer-Policy`、`X-Frame-Options` 等基础安全响应头
- 排障日志只记录结果类别、错误码与耗时，不记录姓名、工号、部门明文

## Vercel 部署

1. 将本仓库连接到 Vercel，Production Branch 使用 `main`。
2. 在 Project Settings → Environment Variables 配置 `ADMIN_PASSWORD`（Production 环境），不要提交到仓库。
3. 使用默认构建命令即可：`npm run vercel-build`，静态目录为 `public/`，`api/[...path].js` 作为 Serverless 入口。
4. 部署后使用 Vercel 分配的 Production URL 访问 `/` 报名页、`/admin` 管理页；`vercel.json` 已将 `/admin` 重写到 `admin.html`。
5. **必须保留 `/api/(.*)` → `/api/[...path]` 重写**：Vercel 零配置路由只会把单段 `/api/<name>` 交给 catch-all 函数，`/api/admin/registrations`、`/api/admin/login`、`/api/admin/export` 这类两段路径会被平台直接返回 404，表现为管理页「名单加载失败，请重试」。`test/vercel-routing.test.js` 会守住这条配置，删除重写会导致测试失败。

## 演示环境限制（重要）

本系统按 Spec OQ-007 部署在 Vercel Production，但名单**只保存在运行实例内存中**：

- 冷启动、重新部署、实例回收或扩缩容会清空名单；不同访问者可能落到不同实例并看到不同名单
- 因此不保证跨实例的全局 50 人上限与行政“完整名单”；管理页固定展示“本系统使用内存存储，实例重启/切换会清空名单”
- 业务已确认本期为演示环境、数据丢失可接受（RISK-003）；若转正式生产，必须改为持久化存储并重新评审名额与名单一致性
- 活动结束后线上数据随实例结束消失；导出的 CSV 由行政保管并在 7 个自然日内删除
