# sdenv 方案 — 瑞数反爬 Cookie 生成

基于 [pysunday/sdenv](https://github.com/pysunday/sdenv) (魔改 jsdom) 让瑞数 JS 在 Node.js 中真实执行, 自动生成有效 Cookie。

## 原理

sdenv 在 jsdom 基础上补齐了瑞数检测的关键浏览器特征:

| 检测点 | 原生 jsdom | sdenv |
|--------|-----------|-------|
| `typeof document.all` | `"object"` (不存在) | `"undefined"` 但可调用 (C++ V8 Addon) |
| Canvas API | 报错 | 集成 canvas 包, 支持 2d/webgl |
| 环境指纹 | 大量缺失 | 完整模拟 screen/navigator/performance |
| eval 作用域 | 与浏览器不同 | 修复作用域链 |

核心是 `documentAll.node` (51 行 C++), 用 V8 的 `ObjectTemplate::MarkAsUndetectable()` 实现 `document.all` 的浏览器特有行为。

## 安装

```bash
cd sdenv

# 必须用 pnpm (npm 11.x + Node 24 有依赖解析死循环 bug)
npx pnpm add sdenv

# 编译原生模块 (需要 VS Build Tools / gcc)
npx pnpm rebuild sdenv
```

**验证安装成功:**
```bash
node -e "require('sdenv'); console.log('ok')"
```

如果报错 `Cannot find module ... documentAll.node`, 需要手动编译:
```bash
cd node_modules/.pnpm/sdenv@*/node_modules/sdenv
npx node-gyp rebuild
```

## 使用

### 基本用法

```javascript
const { RuishuClient } = require('./client');

const client = new RuishuClient({
    host: 'TARGET_HOST',
    port: 80,
    entryPath: '/TARGET_PATH',
});

await client.init();  // 访问页面 → 执行瑞数 JS → 生成 Cookie

// GET 请求 (只需 Cookie)
const page = await client.get('/page');
console.log(page.status);  // 200

// POST 请求
const data = await client.post('/api', { key: 'value' });
console.log(data.body);

client.close();
```

### API

#### `new RuishuClient(config)`

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `host` | `'TARGET_HOST'` | 目标主机 |
| `port` | `80` | 端口 |
| `entryPath` | `'/TARGET_PATH'` | 入口页面路径 (返回 412 的页面) |
| `userAgent` | Chrome 146 UA | User-Agent |

#### `client.init()` → Promise

访问入口页面, 等待瑞数 JS 执行完毕, 提取 Cookie。

#### `client.get(path)` → Promise<{ status, body, headers }>

用生成的 Cookie 发送 GET 请求。

#### `client.post(path, data)` → Promise<{ status, body }>

发送 POST 请求。`data` 可以是字符串或对象 (自动 URL 编码)。

#### `client.close()`

关闭 DOM, 释放资源。

## 适用场景

| 场景 | 推荐方案 |
|------|---------|
| 快速验证站点是否为瑞数 | sdenv |
| 采集参考数据 (basearr/keys) 用于纯算适配 | sdenv |
| 不需要 URL 后缀的 GET/POST 请求 | sdenv |
| 需要 URL 后缀的站点 | JsRpc (sdenv 不生成后缀) |
| 高频采集 (毫秒级响应) | 纯算方案 |

## 文件

| 文件 | 说明 |
|------|------|
| `client.js` | RuishuClient 类 (可直接使用或 require) |
| `pnpm-workspace.yaml` | pnpm 构建配置 |
