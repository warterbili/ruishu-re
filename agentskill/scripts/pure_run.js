/**
 * 瑞数 Cookie T 纯算生成 — 全动态, 零本地依赖
 * 用法: node pure_run.js
 *
 * 流程:
 *   1. GET → 412 + cd + nsd + Cookie S
 *   2. GET mainjs URL → mainjs 源码
 *   3. extractKeys(cd) → keys
 *   4. new Coder(nsd, cd, mainjs).run() → eval 代码 + codeUid
 *   5. buildBasearr(config, keys) → basearr
 *   6. generateCookie(basearr, keys) → Cookie T
 *   7. GET with Cookie S + Cookie T → 200
 */
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');

// === 配置 (修改这里) ===
const HOST = 'TARGET_HOST';
const PORT = 80;
const PATH = '/TARGET_PATH';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

// === 需要导入 ===
// const { Coder, grenKeys } = require('../lib/coder');
// const { buildBasearr, crc32 } = require('../lib/basearr');
// const { extractKeys } = require('./key_extraction'); // 或内联
// const { generateCookie } = require('./encryption'); // 或内联

function httpGet(p, cookie) {
    return new Promise((resolve, reject) => {
        const h = { 'User-Agent': UA, 'Host': `${HOST}:${PORT}` };
        if (cookie) h['Cookie'] = cookie;
        http.request({ hostname: HOST, port: PORT, path: p, headers: h }, res => {
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

async function main() {
    // Step 1: GET → 412
    console.log('Step 1: 获取 412...');
    const r1 = await httpGet(PATH);
    if (r1.status !== 412) { console.log('非瑞数:', r1.status); return; }

    const cd = r1.body.match(/\$_ts\.cd="([^"]+)"/)[1];
    const nsd = parseInt(r1.body.match(/\$_ts\.nsd=(\d+)/)[1]);
    const cookieS = (r1.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    console.log('  nsd:', nsd, 'cd:', cd.length, 'chars');

    // Step 2: 下载 mainjs (缓存)
    console.log('Step 2: 下载 mainjs...');
    const jsUrl = r1.body.match(/src="([^"]+\.js)"/)[1];
    const cache = path.join(__dirname, 'mainjs_cache.js');
    let mainjs;
    if (fs.existsSync(cache)) {
        mainjs = fs.readFileSync(cache, 'utf-8');
        console.log('  使用缓存:', cache);
    } else {
        mainjs = (await httpGet(jsUrl)).body;
        fs.writeFileSync(cache, mainjs);
        console.log('  下载完成:', mainjs.length, 'chars');
    }

    // Step 3: 提取 keys
    console.log('Step 3: 提取 keys...');
    // const keys = extractKeys(cd);
    // const cookieName = String.fromCharCode(...keys[7]).split(';')[5] + 'T';
    // console.log('  keys:', keys.length, '组, Cookie 名:', cookieName);

    // Step 4: Coder → codeUid
    console.log('Step 4: Coder...');
    // const coder = new Coder(nsd, cd, mainjs);
    // coder.run();
    // const codeUid = computeCodeUid(coder, keys);
    // console.log('  eval:', coder.code.length, 'chars, codeUid:', codeUid);

    // Step 5: basearr
    console.log('Step 5: basearr...');
    // const cp1 = grenKeys(coder.keynameNum, nsd);
    // const basearr = buildBasearr({
    //     userAgent: UA, pathname: PATH, hostname: HOST,
    //     platform: 'Win32', flag: 2830, codeUid,
    //     execNumberByTime: 1600, randomAvg: [50, 8],
    //     innerHeight: 768, innerWidth: 1024,
    //     outerHeight: 768, outerWidth: 1024,
    //     documentHidden: false, _cp1: cp1,
    //     runTime: Math.floor(Date.now()/1000),
    //     startTime: Math.floor(Date.now()/1000) - 1,
    //     currentTime: Date.now(),
    // }, keys);
    // console.log('  basearr:', basearr.length, 'bytes');

    // Step 6: 加密
    console.log('Step 6: 加密...');
    // const cookieT = generateCookie(basearr, keys);
    // console.log('  Cookie T:', cookieT.length, 'chars');

    // Step 7: 验证
    console.log('Step 7: 验证...');
    // const r2 = await httpGet(PATH, [cookieS, cookieName + '=' + cookieT].join('; '));
    // console.log('结果:', r2.status === 200 ? '验证通过!' : '失败: ' + r2.status);

    console.log('TODO: 导入 lib/ 中的实现后取消注释');
}

main().catch(console.error);
