# 订单图片管理系统 - 部署指南

## 📋 环境要求

| 组件 | 版本要求 | 说明 |
|------|----------|------|
| **Node.js** | **20.x** (LTS) | 必须使用 Node.js 20，不支持 22 及以上版本 |
| **npm** | >= 9.0 | 随 Node.js 20 安装 |
| **平台** | EdgeOne Pages / Render | 支持两种部署方式 |

> ⚠️ **重要**: 本项目针对 **Node.js 20.x** 环境优化，EdgeOne Pages 当前最高支持 Node.js 20。

### 确认 Node.js 版本

```bash
# 查看当前版本
node --version
# 应输出: v20.x.x

# 如果版本不对，使用 nvm 切换:
nvm use 20
# 或安装:
nvm install 20
```

项目已配置 `.nvmrc` 文件，使用 `nvm use` 即可自动切换到正确版本。

---

## 一、前置准备

### 1.1 注册所需账号

| 平台 | 地址 | 说明 |
|------|------|------|
| 微信小程序 | https://mp.weixin.qq.com | 注册小程序账号，获取 AppID 和 AppSecret |
| Supabase | https://supabase.com | 免费数据库+存储，用 GitHub 登录 |
| Render | https://render.com | 免费后端部署，用 GitHub 登录 |
| UptimeRobot | https://uptimerobot.com | 免费监控，防止 Render 休眠 |
| GitHub | https://github.com | 代码托管（Render 部署需要） |

### 1.2 安装微信开发者工具

下载地址：https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html

---

## 二、Supabase 配置

### 2.1 创建项目

1. 登录 Supabase → New Project
2. 填写项目名称（如 `order-images`）
3. 设置数据库密码（请记住）
4. Region 选择 **Southeast Asia (Singapore)** — 离国内最近
5. 等待初始化完成（约2分钟）

### 2.2 创建数据库表

进入 **SQL Editor** → 粘贴并执行以下 SQL：

```sql
-- 管理员白名单表
CREATE TABLE admins (
  id        BIGSERIAL PRIMARY KEY,
  openid    VARCHAR(64) NOT NULL UNIQUE,
  name      VARCHAR(50),
  role      VARCHAR(20) DEFAULT 'admin',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 订单表
CREATE TABLE orders (
  id          BIGSERIAL PRIMARY KEY,
  order_no    VARCHAR(50) NOT NULL,
  openid      VARCHAR(64) NOT NULL,
  image_count INTEGER DEFAULT 0,
  status      VARCHAR(20) DEFAULT 'active',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_orders_order_no_openid ON orders(order_no, openid);
CREATE INDEX idx_orders_openid ON orders(openid);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);

-- 图片表
CREATE TABLE images (
  id          BIGSERIAL PRIMARY KEY,
  order_no    VARCHAR(50) NOT NULL,
  openid      VARCHAR(64) NOT NULL,
  storage_path VARCHAR(500) NOT NULL,
  file_name   VARCHAR(255),
  file_size   INTEGER,
  mime_type   VARCHAR(50) DEFAULT 'image/jpeg',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_images_order_no ON images(order_no);
CREATE INDEX idx_images_openid ON images(openid);
CREATE INDEX idx_images_order_created ON images(order_no, created_at);

-- 开启 RLS
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE images ENABLE ROW LEVEL SECURITY;

-- RLS 策略
CREATE POLICY "admins_read" ON admins FOR SELECT USING (true);
CREATE POLICY "orders_own_access" ON orders FOR ALL
  USING (openid = (auth.jwt()->>'sub')::text);
CREATE POLICY "images_own_access" ON images FOR ALL
  USING (openid = (auth.jwt()->>'sub')::text);
```

### 2.3 创建 Storage Bucket

1. 进入 **Storage** → **New Bucket**
2. 名称：`order-images`
3. 勾选 **Public bucket**
4. 创建后在 **Policies** 中添加：

```sql
-- 允许上传（用户只能上传到自己目录）
CREATE POLICY "upload_own" ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'order-images'
    AND (storage.foldername(name))[1] = (auth.jwt()->>'sub')::text
  );

-- 允许公开读取
CREATE POLICY "public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'order-images');
```

### 2.4 获取 API Keys

进入 **Project Settings → API**：
- 复制 `Project URL` → 即 `SUPABASE_URL`
- 复制 `anon public key` → 即 `SUPABASE_ANON_KEY`
- 复制 `service_role key` → 即 `SUPABASE_SERVICE_ROLE_KEY`（仅后端使用！）

---

## 三、部署方式

### 方式 A：EdgeOne Pages（推荐，国内访问更快）

#### 3A.1 项目结构要求

```
server/
├── package.json          # 包含 engines 字段指定 Node.js 20
├── .nvmrc                # Node.js 版本控制文件
├── cloud-functions/
│   └── api/
│       └── [[default]].js  # EdgeOne Functions 入口
└── DEPLOY.md
```

#### 3A.2 EdgeOne 控制台配置

1. 登录 [腾讯云 EdgeOne 控制台](https://console.cloud.tencent.com/edgeone)
2. 创建 **EdgeOne Pages** 站点
3. 连接 GitHub 仓库或手动上传
4. **运行环境设置**：
   - 运行时：**Node.js 20**
   - 构建命令：`npm install`
   - 输出目录：`cloud-functions`

#### 3A.3 配置环境变量

在 EdgeOne Pages 控制台的环境变量设置中添加：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `SUPABASE_URL` | 你的 Supabase Project URL | 必填 |
| `SUPABASE_SERVICE_ROLE_KEY` | 你的 Supabase service_role key | 必填 |
| `WX_APPID` | 微信小程序 AppID | 必填 |
| `WX_SECRET` | 微信小程序 AppSecret | 必填 |

#### 3A.4 部署验证

部署完成后，访问 `https://你的域名/api/health` 验证服务状态。

---

### 方式 B：Render（国际访问）

#### 3B.1 推送代码到 GitHub

```bash
cd server
git init
git add .
git commit -m "初始提交"
git branch -M main
git remote add origin https://github.com/你的用户名/order-image-api.git
git push -u origin main
```

#### 3B.2 在 Render 创建 Web Service

1. Render 控制台 → **New Web Service**
2. 连接 GitHub → 选择 `order-image-api` 仓库
3. 配置：
   - **Name**: `order-image-api`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node index.js`
   - **Instance Type**: **Free**

#### 3B.3 添加环境变量

在 Render 的环境变量设置中添加：

| 变量名 | 值 |
|--------|-----|
| `SUPABASE_URL` | 你的 Supabase Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 你的 Supabase service_role key |
| `WX_APPID` | 微信小程序 AppID |
| `WX_SECRET` | 微信小程序 AppSecret |
| `ADMIN_OPENIDS` | 管理员 openid（逗号分隔） |
| `JWT_SECRET` | 随机生成一个长字符串 |

#### 3B.4 部署并获取 URL

点击 **Create Web Service**，等待部署完成。记下你的 Render URL，如：
`https://order-image-api.onrender.com`

---

## 四、UptimeRobot 防休眠

Render 免费实例 15 分钟无请求会休眠，用 UptimeRobot 保持活跃：

1. 注册 https://uptimerobot.com
2. 添加监控 → HTTP(s)
3. URL: `https://order-image-api.onrender.com/api/health`
4. 监控间隔：**5 分钟**
5. 这样 Render 永远不会休眠

---

## 五、微信小程序配置

### 5.1 修改配置文件

修改 `miniprogram/utils/supabase.js`：
```javascript
const SUPABASE_URL = 'https://你的项目.supabase.co';
const SUPABASE_ANON_KEY = '你的anon key';
```

修改 `miniprogram/utils/config.js`：
```javascript
API_BASE: 'https://order-image-api.onrender.com/api',
```

修改 `miniprogram/app.js`：
```javascript
apiBase: 'https://order-image-api.onrender.com/api',
```

### 5.2 配置服务器域名白名单

微信小程序管理后台 → 开发管理 → 开发设置 → 服务器域名：

**request 合法域名**：
- `https://你的项目.supabase.co`
- `https://order-image-api.onrender.com`

**uploadFile 合法域名**：
- `https://你的项目.supabase.co`

### 5.3 在微信开发者工具中运行

1. 打开微信开发者工具
2. 导入项目 → 选择 `miniprogram/` 目录
3. 填写 AppID
4. 点击编译预览

---

## 六、添加管理员

### 6.1 获取你的 OpenID

方法1：在小程序中运行，查看控制台日志
方法2：调用 `/api/auth/login` 接口返回的 openid

### 6.2 添加到数据库

在 Supabase **Table Editor** → `admins` 表 → **Insert row**：

```json
{
  "openid": "你的微信OpenID",
  "name": "管理员",
  "role": "admin"
}
```

### 6.3 同步环境变量

同时将 openid 添加到 Render 的 `ADMIN_OPENIDS` 环境变量中（逗号分隔多个）。

---

## 七、验证清单

- [ ] Supabase 项目创建成功，表结构正确
- [ ] Storage bucket 创建成功，权限配置正确
- [ ] Render 服务部署成功，`/api/health` 可访问
- [ ] UptimeRobot 监控已添加
- [ ] 小程序可正常编译运行
- [ ] 用户端：可输入订单号、选择图片、上传成功
- [ ] 管理端：管理员可登录、查询订单、预览图片、批量下载
- [ ] 批量下载 ZIP 文件正常

---

## 八、常见问题

**Q: 小程序提示 "request 域名不在白名单"**
A: 确认在微信管理后台添加了 Supabase 和 Render 的域名。

**Q: Render 首次请求很慢**
A: 免费实例休眠后首次唤醒需要30-50秒，配置 UptimeRobot 可避免。

**Q: 图片上传失败**
A: 检查 Supabase Storage bucket 是否设为 public，以及 RLS 策略是否正确。

**Q: 管理端登录失败**
A: 确认 `ADMIN_OPENIDS` 环境变量中包含了正确的 openid，且 openid 已添加到 `admins` 表。
