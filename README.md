# YunMusic

一个基于 **Telegram 作为存储空间** 的自部署 MP3 播放工具（Cloudflare Pages Functions）。

当前仓库已做过一次“遗留代码瘦身”，仅保留音乐播放主链路所需模块。

---

## 1. 当前能力（MVP）

- `AUTH_CODE` 访问控制（未认证无法打开 `/music/` 页面）
- 音乐列表加载（搜索 / 排序 / 分页）
- 上传音频（仅 MP3 / M4A）
- 流式播放（支持 `Range` 与进度拖拽）

默认入口：

- `/` 自动跳转到 `/music/`

---

## 2. 核心目录

```txt
.
├── index.html
├── music/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── functions/
│   ├── music/_middleware.js               # /music 页面级鉴权
│   ├── api/music/
│   │   ├── list.js
│   │   ├── upload.js
│   │   └── stream/[[id]].js
│   ├── upload/                            # 复用上传主链路
│   ├── file/                              # 复用文件读取主链路
│   └── utils/
└── docs/telegram-mp3-product-design.md
```

---

## 3. API 概览

### 3.1 `GET /api/music/list`

Query 参数（可选）：

- `authCode`
- `q` / `search`
- `start`（默认 `0`）
- `count`（默认 `50`，最大 `200`）
- `sort`（`timeDesc|timeAsc|nameAsc|nameDesc|sizeAsc|sizeDesc`）
- `dir`
- `recursive=true|false`

### 3.2 `POST /api/music/upload`

- Content-Type: `multipart/form-data`
- 字段：`file`（必须，MP3/M4A）

Query 参数（可选）：

- `authCode`
- `channelName`
- `dir`

### 3.3 `GET /api/music/stream/:id`

- 支持 `Range`
- 可带 `authCode`

---

## 4. 本地开发

```bash
npm install
npm start
```

默认地址：

- `http://localhost:8080`

`npm start` 实际命令：

```bash
wrangler pages dev ./ --kv yun_music --r2 yun_r2 --ip 0.0.0.0 --port 8080 --persist-to ./data
```

---

## 5. Cloudflare Pages 部署

### 5.1 Build 设置

- Build command：`npm install`
- Build output directory：`.`
- Root directory：留空（仓库根目录）

### 5.2 Bindings

在 Pages 项目 `Settings -> Bindings` 配置：

1. KV Namespace
   - Variable name：`yun_music`
2. R2 Bucket
   - Variable name：`yun_r2`

> 建议在 Preview 与 Production 都配置，并在变更绑定后重新部署一次。

### 5.3 环境变量

建议至少配置：

- `TG_BOT_TOKEN`（必需）
- `TG_CHAT_ID`（必需）
- `TG_PROXY_URL`（可选）
- `AUTH_CODE`（强烈建议）

---

## 6. 数据与鉴权说明

### 6.1 数据库

支持以下其一：

- KV：`env.yun_music`
- D1：`env.img_d1`

### 6.2 访问控制

- `/music/` 走页面级中间件：未认证时返回认证门禁页。
- `api/music/*`、`/upload`、`/file/*` 请求均受鉴权约束。
- `authCode` 支持 URL 参数与 Cookie 方式。

---

## 7. 常见问题

### 7.1 `Database not configured`

请检查：

1. Pages 项目是否已绑定 `yun_music`（KV）或 `img_d1`（D1）。
2. 绑定是否配置在当前环境（Preview / Production）。
3. 修改绑定后是否触发了新部署。

### 7.2 无法播放或 401

请检查：

1. `AUTH_CODE` 与前端输入是否一致。
2. 请求是否带了 `authCode`（或已写入 Cookie）。
3. `/api/music/list` 是否先返回 200。

---

## 8. 设计文档

- `docs/telegram-mp3-product-design.md`
