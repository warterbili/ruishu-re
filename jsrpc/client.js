/**
 * JsRpc 调用客户端
 *
 * 前置: node server.js + 浏览器注入 inject.js
 *
 * 用法:
 *   node client.js                     — 自动检测站点并测试
 *   node client.js get /path           — GET 请求
 *   node client.js post /path "body"   — POST 请求
 *   node client.js cookie              — 获取 Cookie
 *   node client.js suffix /path        — 获取后缀
 */
const http = require('http');

const RPC = 'http://127.0.0.1:12080';
const GROUP = 'ruishu';

function rpcCall(action, param) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify({ group: GROUP, action, param: param || '' });
        const url = new URL(RPC + '/go');
        const req = http.request({
            hostname: url.hostname, port: url.port,
            path: '/go', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        }, res => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                try {
                    const r = JSON.parse(body);
                    if (r.error) reject(new Error(r.error));
                    else resolve(r.data);
                } catch(e) { resolve(body); }
            });
        });
        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function rpcGet(path) {
    const raw = await rpcCall('get', path);
    return JSON.parse(raw);
}

async function rpcPost(url, body, contentType) {
    const raw = await rpcCall('post', JSON.stringify({ url, body, contentType }));
    return JSON.parse(raw);
}

// ============================================================
// 测试
// ============================================================
async function testAuto() {
    console.log('==========================================');
    console.log('  JsRpc 瑞数通杀客户端');
    console.log('==========================================\n');

    // 检测连接
    try {
        const loc = JSON.parse(await rpcCall('getLocation'));
        console.log('★ 当前站点:', loc.hostname);
        console.log('  路径:', loc.pathname);
        console.log('  协议:', loc.protocol);

        // 获取 Cookie
        const cookie = await rpcCall('getCookie');
        console.log('\n★ Cookie (' + cookie.length + ' chars):');
        console.log('  ' + cookie.substring(0, 80) + '...');

        // 根据站点自动测试
        if (loc.hostname.includes('nmpa.gov.cn')) {
            await testNMPA();
        } else if (loc.hostname.includes('202.127.48.145')) {
            await testTrademark();
        } else {
            // 通用: GET 当前页面
            console.log('\n★ GET', loc.pathname);
            const r = await rpcGet(loc.pathname);
            console.log('  status:', r.status, 'bodyLen:', r.bodyLen);
        }
    } catch(e) {
        console.error('连接失败:', e.message);
        console.log('\n请确保:');
        console.log('  1. server.js 正在运行');
        console.log('  2. 浏览器已注入 inject.js');
    }

    console.log('\n==========================================');
}

async function testNMPA() {
    console.log('\n--- 药监局测试 ---\n');

    // GET 公告页面
    console.log('1. GET /xxgk/ggtg/index.html');
    const r1 = await rpcGet('/xxgk/ggtg/index.html');
    console.log('   status:', r1.status, 'bodyLen:', r1.bodyLen);
    if (r1.status === 200) console.log('   ✅ 页面获取成功!');

    // GET 药品查询页面
    console.log('\n2. GET /yaopin/index.html');
    try {
        const r2 = await rpcGet('/yaopin/index.html');
        console.log('   status:', r2.status, 'bodyLen:', r2.bodyLen);
    } catch(e) { console.log('   error:', e.message); }

    // GET 数据接口
    console.log('\n3. GET /datasearch/search-info.html');
    try {
        const r3 = await rpcGet('/datasearch/search-info.html');
        console.log('   status:', r3.status, 'bodyLen:', r3.bodyLen);
    } catch(e) { console.log('   error:', e.message); }
}

async function testTrademark() {
    console.log('\n--- 商标查询站点测试 ---\n');

    // GET 主页
    console.log('1. GET 主页');
    const r1 = await rpcGet('/zscq/search/jsp/vBrandSearchIndex.jsp');
    console.log('   status:', r1.status, 'bodyLen:', r1.bodyLen);

    // POST 查询
    console.log('\n2. POST 查询 "华为"');
    const r2 = await rpcPost(
        '/searchUser/searchAction!getVRecordListPage.do',
        'page=1&rows=3&sidx=RECORD_NUM&sord=desc&RECORD_NAME=%E5%8D%8E%E4%B8%BA&_search=false&nd=' + Date.now()
    );
    console.log('   status:', r2.status);
    if (r2.status === 200) {
        try {
            const data = JSON.parse(r2.body);
            console.log('   records:', data.records);
            (data.rows || []).forEach((row, i) => {
                console.log('   [' + (i+1) + ']', row.APPLY_USER_NAME, '|', row.RECORD_NAME);
            });
        } catch(e) {}
    }

    // POST 国家筛选
    console.log('\n3. POST 美国商标');
    const r3 = await rpcPost(
        '/searchUser/searchAction!getVRecordListPage.do',
        'page=1&rows=3&sidx=RECORD_NUM&sord=desc&COUNTRY=502&_search=false&nd=' + Date.now()
    );
    console.log('   status:', r3.status);
    if (r3.status === 200) {
        try {
            const data = JSON.parse(r3.body);
            console.log('   records:', data.records);
        } catch(e) {}
    }
}

// CLI
const args = process.argv.slice(2);
if (args[0] === 'get') {
    rpcGet(args[1] || '/').then(r => {
        console.log('status:', r.status);
        console.log('url:', r.url);
        console.log('bodyLen:', r.bodyLen);
        if (r.bodyLen < 2000) console.log(r.body);
    }).catch(e => console.error(e.message));
} else if (args[0] === 'post') {
    rpcPost(args[1], args[2] || '').then(r => {
        console.log('status:', r.status);
        console.log(r.body.substring(0, 500));
    }).catch(e => console.error(e.message));
} else if (args[0] === 'cookie') {
    rpcCall('getCookie').then(c => console.log(c)).catch(e => console.error(e.message));
} else if (args[0] === 'suffix') {
    rpcCall('getSuffix', args[1] || '').then(s => console.log(s)).catch(e => console.error(e.message));
} else {
    testAuto().catch(e => console.error(e.message));
}

module.exports = { rpcCall, rpcGet, rpcPost };
