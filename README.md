# YunMusic

一个基于 **Telegram 作为存储空间** 的自部署 MP3 播放工具（Cloudflare Pages Functions）。

当前版本已使用新的前端界面，并适配本项目现有后端 API。

---

## 1. 当前能力（MVP）

- `AUTH_CODE` 访问控制（未认证无法打开 `/music/`）
- 音乐列表加载（搜索 / 排序 / 分页加载）
- 上传音频（仅 MP3 / M4A）
- 网页流式播放（支持 `Range` 与进度拖拽）

默认入口：`/` 自动跳转到 `/music/`。

---

## 2. 核心目录

```txt
.
├── index.html
├── music/
│   ├── index.html                # 前端入口
│   ├── assets/                   # 前端打包产物
│   └── vite.svg
├── functions/
│   ├── music/_middleware.js      # /music 页面级鉴权
│   ├── api/music/
│   │   ├── list.js
│   │   ├── upload.js
│   │   └── stream/[[id]].js
│   ├── upload/                   # 复用上传链路
│   ├── file/                     # 复用文件读取链路
│   └── utils/
└── docs/telegram-mp3-product-design.md
```

---

## 3. API 概览

### `GET /api/music/list`

可选参数：

- `q` / `search`
- `start`（默认 `0`）
- `count`（默认 `50`，最大 `200`）
- `sort`（`timeDesc|timeAsc|nameAsc|nameDesc|sizeAsc|sizeDesc`）
- `dir`
- `recursive=true|false`
- `authCode`（可选，通常由 Cookie 承载）

### `POST /api/music/upload`

- `multipart/form-data`
- 字段：`file`（必须，MP3/M4A）

可选参数：`channelName`、`dir`、`authCode`。

### `GET /api/music/stream/:id`

- 支持 `Range`
- 可带 `authCode`

---

## 4. 本地开发

```bash
npm install
npm start
```

默认地址：`http://localhost:8080`

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

1. KV Namespace：`yun_music`
2. R2 Bucket：`yun_r2`

建议 Preview / Production 都配置，并在修改绑定后重新部署。

### 5.3 环境变量

建议至少配置：

- `TG_BOT_TOKEN`
- `TG_CHAT_ID`
- `TG_PROXY_URL`（可选）
- `AUTH_CODE`（强烈建议）

---

## 6. 数据与鉴权

- 数据库支持：`env.yun_music`（KV）或 `env.img_d1`（D1）
- `/music/` 由页面级中间件守卫：未认证返回认证门禁页
- `api/music/*`、`/upload`、`/file/*` 都受鉴权约束

---

## 7. 常见问题

### 7.1 `Database not configured`

请检查：

1. 是否绑定了 `yun_music`（KV）或 `img_d1`（D1）
2. 绑定是否设置在当前环境（Preview / Production）
3. 绑定变更后是否触发新部署

### 7.2 播放失败或 401

请检查：

1. `AUTH_CODE` 是否正确
2. Cookie 中是否已有有效 `authCode`
3. `/api/music/list` 是否返回 200

---

## 8. 设计文档

- `docs/telegram-mp3-product-design.md`
