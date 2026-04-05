/**
 * JsRpc 服务端 (ws 库版本)
 *
 * 启动：node server.js
 * 端口：12080
 */
const http = require('http');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = 12080;
const clients = {};
const pending = {};

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    if (url.pathname === '/list') {
        res.end(JSON.stringify({ clients: Object.keys(clients) }));
        return;
    }

    if (url.pathname === '/go') {
        let body = '';
        req.on('data', d => body += d);
        req.on('end', () => {
            const params = Object.fromEntries(url.searchParams);
            if (body) {
                try { Object.assign(params, JSON.parse(body)); } catch(e) {
                    new URLSearchParams(body).forEach((v, k) => params[k] = v);
                }
            }
            const { group, action, param } = params;
            if (!group || !action) { res.end(JSON.stringify({ error: 'need group and action' })); return; }
            const ws = clients[group];
            if (!ws) { res.end(JSON.stringify({ error: 'not connected: ' + group })); return; }

            const id = crypto.randomUUID();
            pending[id] = {
                resolve: (data) => res.end(JSON.stringify({ status: 'ok', data })),
                timeout: setTimeout(() => { delete pending[id]; res.end(JSON.stringify({ error: 'timeout' })); }, 30000)
            };
            ws.send(JSON.stringify({ action, id, param: param || '' }));
        });
        return;
    }

    res.end(JSON.stringify({ endpoints: ['/go', '/list'] }));
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const group = url.searchParams.get('group') || 'default';
    clients[group] = ws;
    console.log('[WS] 连接:', group);

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            if (msg.id && pending[msg.id]) {
                clearTimeout(pending[msg.id].timeout);
                pending[msg.id].resolve(msg.data);
                delete pending[msg.id];
            }
        } catch(e) {}
    });

    ws.on('close', () => { console.log('[WS] 断开:', group); delete clients[group]; });
    ws.on('error', () => { delete clients[group]; });
});

server.listen(PORT, () => {
    console.log('★★★ JsRpc Server on http://127.0.0.1:' + PORT);
    console.log('  /go?group=ruishu&action=getCookie');
    console.log('  /go?group=ruishu&action=getSuffix');
    console.log('  /go?group=ruishu&action=post');
});
