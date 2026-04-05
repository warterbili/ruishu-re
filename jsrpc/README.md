# JsRpc 瑞数通杀方案

通过 WebSocket RPC 调用浏览器中的瑞数方法，Cookie + 后缀全自动。
**已验证通过：商标查询站点 + 药监局（瑞数6最严格站点）。**

## 原理

```
Node.js/Python ←HTTP→ JsRpc Server ←WebSocket→ 浏览器
                                                  ↓
                                            瑞数 VM 自动生成
                                            Cookie + 后缀
                                                  ↓
                                            返回完整响应
```

## 文件

```
jsrpc/
├── server.js   ← 服务端 (需要 ws 库: npm install)
├── inject.js   ← 浏览器注入脚本
├── client.js   ← Node.js 客户端 (自动检测站点)
└── README.md
```

## 使用

### 1. 安装 + 启动服务端
```bash
cd jsrpc
npm install
node server.js
```

### 2. 浏览器注入
1. 打开目标网站
2. F12 → Console
3. 粘贴 inject.js 全部内容，回车
4. 看到 `[RPC] ★ 已连接` + `[RPC] ★★★ 就绪!`

### 3. 调用
```bash
# 自动测试
node client.js

# GET 请求
node client.js get /xxgk/ggtg/index.html

# POST 请求
node client.js post /api/data "page=1&rows=10"

# 获取 Cookie
node client.js cookie

# 获取后缀
node client.js suffix /path
```

### HTTP API
```
GET  /go?group=ruishu&action=getCookie
GET  /go?group=ruishu&action=get&param=/path
POST /go  {"group":"ruishu","action":"post","param":"{\"url\":\"/api\",\"body\":\"data\"}"}
GET  /list
```

## 验证结果

| 站点 | Cookie | GET | POST | 后缀 |
|------|--------|-----|------|------|
| 商标查询 (202.127.48.145) | ✅ | ✅ | ✅ 200 | 自动 |
| 药监局 (nmpa.gov.cn) | ✅ | ✅ 200 | - | 自动 |
