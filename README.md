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

### 4.3 Cloudflare Pages 部署细节（推荐）

下面给出一套可直接落地的配置流程（Git 集成部署）：

1. 在 Cloudflare Dashboard 打开 **Workers & Pages**，创建/选择你的 Pages 项目。
2. 连接本仓库并选择默认分支（通常是 `main`）。
3. 在 **Build** 配置中建议使用：
   - **Build command**：`npm install`
   - **Build output directory**：`.`（项目根目录）
   - **Root directory**：留空（仓库根目录部署）
4. 项目中 `functions/` 目录会被 Pages Functions 自动识别，无需额外改动。

> 说明：Cloudflare 官方文档允许“无框架项目不填写 build command”，但本项目包含 Functions 依赖，建议保留 `npm install` 以确保依赖解析稳定。

### 4.4 Bindings 配置（重点）

进入 Pages 项目：**Settings** -> **Bindings**，按需添加：

1. **KV Namespace**
   - Variable name：`img_url`
   - 绑定你的 KV 命名空间（用于文件索引与元数据）
2. **R2 Bucket**
   - Variable name：`img_r2`
   - 绑定你的 R2 Bucket（本项目本地脚本默认也使用该命名）

建议在 **Preview** 和 **Production** 两个环境都配置对应绑定。

> 官方文档建议：绑定调整后重新部署一次，让新绑定在当前部署中生效。

### 4.5 环境变量建议（Preview / Production 分开）

进入 Pages 项目：**Settings** -> **Variables and Secrets**（或 Environment Variables），建议分别配置：

- `TG_BOT_TOKEN`（必需，Telegram Bot Token）
- `TG_CHAT_ID`（必需，目标频道/会话 ID）
- `TG_PROXY_URL`（可选，Telegram 代理域名）
- `AUTH_CODE`（建议配置，用于前端/API 访问码）

建议策略：

1. **Preview** 使用测试 Bot 与测试频道。
2. **Production** 使用正式 Bot 与正式频道。
3. 变量修改后触发一次新部署再验证。

### 4.6 部署后自检清单

部署完成后，建议按顺序验证：

1. 打开 `/music/` 页面可以正常访问。
2. 输入 `authCode` 后可加载音乐列表（`GET /api/music/list` 返回 200）。
3. 上传一首 MP3/M4A 成功（`POST /api/music/upload` 返回 200）。
4. 点击歌曲可播放并可拖动进度（`GET /api/music/stream/:id` 出现 206/Range）。
5. 若失败，先检查：Bindings 命名是否正确（`img_url`、`img_r2`）与 Telegram 变量是否匹配。

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

## 7. 分页加载说明

YunMusic 前端已启用分页加载机制，默认行为如下：

1. 首次加载按 `count=50` 拉取第一页（`start=0`）。
2. 点击“加载更多”后，按当前已加载数量作为下一个 `start` 继续拉取。
3. 页面会显示 `已加载 X / Y`，其中 `Y` 为后端返回的 `totalCount`。
4. 当 `X >= Y` 时，“加载更多”按钮自动隐藏。
5. 搜索词变更或排序变更会重置分页，从第一页重新加载。

相关代码位置：

- 分页参数与状态：`music/app.js`
- 前端分页控件：`music/index.html`
- 后端分页接口：`functions/api/music/list.js`

---

## 8. 常见鉴权失败排查

当你在页面看到“登录失效”或“未授权”时，可按以下顺序排查：

1. **确认 authCode 是否正确**
   - 前端输入框中的访问码应与服务端配置一致。
2. **确认服务端认证来源**
   - 项目会从系统配置（`manage@sysConfig@security`）和环境变量（如 `AUTH_CODE`）读取认证设置。
3. **清理浏览器本地状态**
   - 点击页面“退出”，重新输入 `authCode` 登录。
4. **检查请求参数是否带上 authCode**
   - `api/music/list`、`api/music/upload`、`api/music/stream/*` 请求应带上正确的 `authCode`。
5. **确认代理/网关未篡改请求**
   - 若前面有反向代理，请确保查询参数和头未被清洗。

---

## 9. 已知限制

1. 前端当前是 MVP 页面，暂无歌单、歌词、封面提取等能力。
2. 上传接口当前仅开放 MP3/M4A，其他格式暂不支持。
3. 列表默认最大拉取 200 条，后续可改为分页滚动加载。

---

## 10. 后续规划

- 歌单系统（创建/排序/收藏）
- ID3 元数据解析（标题/歌手/专辑/封面）
- 更细粒度错误提示与可观测性
- 移动端交互优化

---

## 11. 相关文档

- 产品设计：`docs/telegram-mp3-product-design.md`
- API 文档：`docs/api.md`
