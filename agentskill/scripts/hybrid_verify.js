/**
 * 混合验证: sdenv basearr + 纯算加密 = 200
 * 证明加密链独立于 basearr 正确性
 * 用法: node hybrid_verify.js
 *
 * 原理: 从 sdenv 拿真实 basearr, 用纯算 generateCookie 重新加密
 *       如果返回 200, 说明加密链 100% 正确
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const vm = require('vm');
const crypto = require('crypto');
const http = require('http');
const { jsdomFromUrl } = require('sdenv');

// === 配置 ===
const HOST = 'TARGET_HOST';
const PORT = 80;
const PATH = '/TARGET_PATH';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

// === 需要导入的函数 ===
// const { extractKeys, decryptCookieT, generateCookie } = require('../lib/...');

function httpGet(path, cookie) {
    return new Promise((resolve, reject) => {
        const h = { 'User-Agent': UA, 'Host': `${HOST}:${PORT}` };
        if (cookie) h['Cookie'] = cookie;
        http.request({ hostname: HOST, port: PORT, path, headers: h }, res => {
            const chunks = [];
            res.on('data', d => chunks.push(d));
            res.on('end', () => resolve({
                status: res.statusCode,
                headers: res.headers,
                body: Buffer.concat(chunks).toString('utf-8'),
            }));
        }).on('error', reject).end();
    });
}

async function hybridVerify() {
    // 1. 获取 412 + cd
    const r1 = await httpGet(PATH);
    console.log('Step 1: GET →', r1.status);
    if (r1.status !== 412) { console.log('不是瑞数防护'); return; }

    const cd = r1.body.match(/\$_ts\.cd="([^"]+)"/)?.[1];
    const cookieS = (r1.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

    // 2. 提取 keys
    // const keys = extractKeys(cd);
    // const cookieName = String.fromCharCode(...keys[7]).split(';')[5] + 'T';

    // 3. sdenv 获取真实 Cookie T
    const url = `http://${HOST}:${PORT}${PATH}`;
    const dom = await jsdomFromUrl(url, { userAgent: UA, consoleConfig: { error: () => {} } });
    await new Promise(r => { dom.window.addEventListener('sdenv:exit', r); setTimeout(r, 8000); });
    const cookies = dom.cookieJar.getCookieStringSync(url);
    const cookieT = cookies.match(/T=([^;]+)/)?.[1];
    dom.window.close();

    // 4. 解密 Cookie T → basearr
    // const realBasearr = decryptCookieT(cookieT, keys);
    // console.log('basearr:', realBasearr.length, 'bytes');

    // 5. 纯算重新加密
    // const newCookieT = generateCookie(realBasearr, keys);

    // 6. 验证
    // const r2 = await httpGet(PATH, cookieS + '; ' + cookieName + '=' + newCookieT);
    // console.log('Step 6: 混合验证 →', r2.status);
    // console.log(r2.status === 200 ? '加密链验证通过!' : '加密链有误, 不要继续');

    console.log('TODO: 导入 extractKeys/decryptCookieT/generateCookie 后取消注释');
}

hybridVerify().catch(console.error);
