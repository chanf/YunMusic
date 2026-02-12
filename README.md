# YunMusic

一个基于 **Telegram 作为存储空间** 的自部署 MP3 播放工具。

当前版本聚焦 MVP：

- 上传音频（MP3/M4A）
- 音乐库检索
- 网页流式播放（支持 Range/拖拽）

---

## 1. 项目状态

本仓库已从原“通用文件托管/图床”方向，收敛为“Telegram 音乐播放器”产品形态。

目前可用闭环：

1. 登录（`authCode`）
2. 加载音乐库
3. 上传 MP3/M4A
4. 立即播放、切歌、拖拽进度

默认入口：

- `/` 自动跳转到 `/music/`

---

## 2. 功能概览

### 2.1 前端（`/music/`）

- 登录态管理（`authCode`）
- 音乐列表：搜索、排序、刷新
- 文件上传：仅允许 MP3/M4A
- 底部播放器：播放/暂停、上一首、下一首、进度拖拽
- 本地记录：最近播放歌曲与断点恢复（仅同一首恢复）

### 2.2 后端 API（Music 域）

- `GET /api/music/list`
  - 鉴权
  - 仅返回音频文件
  - 支持搜索/分页/排序
- `POST /api/music/upload`
  - 鉴权
  - 音频类型校验（MP3/M4A）
  - 复用既有 `/upload` 上传到 Telegram
- `GET /api/music/stream/:id`
  - 鉴权
  - 代理 `/file/:id`
  - 透传 `Range` 请求，支持流式播放

### 2.3 Telegram 扩展接口

- `POST /api/telegram/media-group-upload`
  - 支持 Telegram 媒体组批量上传（2~10）
  - 支持幂等 `requestId`
  - 结果写入 metadata 并返回可访问地址

---

## 3. 目录结构（核心）

```txt
.
├── index.html                          # 根入口，跳转 /music/
├── music/
│   ├── index.html                      # 音乐播放器页面
│   ├── app.js                          # 前端交互逻辑
│   └── style.css                       # 页面样式
├── functions/
│   ├── api/music/
│   │   ├── list.js                     # 音乐列表 API
│   │   ├── upload.js                   # 音乐上传 API
│   │   └── stream/[[id]].js            # 音乐流式代理 API
│   ├── api/telegram/media-group-upload.js
│   ├── upload/index.js                 # 既有上传主链路（被复用）
│   └── file/[[path]].js                # 既有文件读取链路（被复用）
└── docs/telegram-mp3-product-design.md # 产品设计文档
```

---

## 4. 运行与开发

### 4.1 本地开发

```bash
npm install
npm start
```

默认本地地址：

- `http://localhost:8080`

`npm start` 使用 `wrangler pages dev`，并绑定：

- KV: `img_url`
- R2: `img_r2`

> 说明：测试命令 `npm test` 依赖本地 mocha 环境，若你当前依赖目录异常，可能会失败。

### 4.2 生产部署（Cloudflare Pages Functions）

可沿用原项目部署方式，核心是保证：

1. Functions 正常启用
2. 数据库绑定可用（KV 或 D1）
3. Telegram 上传渠道可用

---

## 5. 配置说明（最小必需）

## 5.1 Telegram 上传渠道

至少需要一组 Telegram 渠道配置：

- `botToken`
- `chatId`
- `proxyUrl`（可选）

可通过以下方式提供：

1. 环境变量（例如 `TG_BOT_TOKEN`、`TG_CHAT_ID`）
2. 管理接口系统配置（写入 `manage@sysConfig@upload`）

## 5.2 访问认证

用户访问码（`authCode`）用于前端与 API 鉴权。

来源优先级遵循现有实现：

- 系统配置 `manage@sysConfig@security`
- 环境变量（如 `AUTH_CODE`）

前端 `/music/` 页面会在请求 `api/music/*` 时附带 `authCode`。

## 5.3 数据库

项目支持：

- KV（`env.img_url`）
- D1（`env.img_d1`）

运行时会自动选择可用适配器。

---

## 6. API 快速参考

### `GET /api/music/list`

Query 参数（可选）：

- `authCode`
- `q` / `search`
- `start`（默认 0）
- `count`（默认 50，最大 200）
- `sort`（`timeDesc|timeAsc|nameAsc|nameDesc|sizeAsc|sizeDesc`）
- `dir`
- `recursive=true|false`

### `POST /api/music/upload`

请求：`multipart/form-data`

- `file`（必须，MP3/M4A）

Query 参数（可选）：

- `authCode`
- `channelName`
- `dir`

### `GET /api/music/stream/:id`

- 支持 `Range`
- 可带 `authCode`

---

## 7. 已知限制

1. 前端当前是 MVP 页面，暂无歌单、歌词、封面提取等能力。
2. 上传接口当前仅开放 MP3/M4A，其他格式暂不支持。
3. 列表默认最大拉取 200 条，后续可改为分页滚动加载。

---

## 8. 后续规划

- 歌单系统（创建/排序/收藏）
- ID3 元数据解析（标题/歌手/专辑/封面）
- 更细粒度错误提示与可观测性
- 移动端交互优化

---

## 9. 相关文档

- 产品设计：`docs/telegram-mp3-product-design.md`
- API 文档：`docs/api.md`

