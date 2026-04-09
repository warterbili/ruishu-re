/**
 * 瑞数 Cookie T 纯算全流程 — 全动态, 零本地依赖
 *
 * 全流程:
 *   1. HTTP GET 目标页面 → 412 + cd + nsd + Cookie S
 *   2. 从 412 HTML 提取 mainjs URL → HTTP GET 下载 mainjs
 *   3. extractKeys(cd) → 45 组 keys
 *   4. Coder(nsd, cd, mainjs) → codeUid
 *   5. buildBasearr(config, keys) → basearr
 *   6. generateCookie(basearr, keys) → Cookie T
 *   7. Cookie S + Cookie T → HTTP GET → 200
 *
 * 用法: node run.js
 */
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Coder, grenKeys } = require('./coder.js');
const { buildBasearr } = require('./basearr.js');

// ============================================================
//  配置 (换站点只改这里)
// ============================================================
const HOST = '202.127.48.145', PORT = 8888;
const PATH = '/zscq/search/jsp/vBrandSearchIndex.jsp';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const BASESTR = 'qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d{}|~ !#$%()*+,-;=?@[]^';

// ============================================================
//  HTTP
// ============================================================
function httpGet(p, cookie) {
    return new Promise((resolve, reject) => {
        const headers = { 'User-Agent': UA, 'Host': `${HOST}:${PORT}` };
        if (cookie) headers['Cookie'] = cookie;
        http.request({ hostname: HOST, port: PORT, path: p, headers }, res => {
            const chunks = [];
            res.on('data', d => chunks.push(d));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf-8') }));
        }).on('error', reject).end();
    });
}

// ============================================================
//  keys 提取
// ============================================================
function mkDK() { const a=[{},{},{},{},{},{}]; for(let i=0;i<BASESTR.length;i++){const c=BASESTR.charCodeAt(i);a[0][c]=i<<2;a[1][c]=i>>4;a[2][c]=(i&15)<<4;a[3][c]=i>>2;a[4][c]=(i&3)<<6;a[5][c]=i;} return a; }
function decCd(s) { const dk=mkDK();const a=[];for(let i=0;i<s.length;i+=4){const c=[0,1,2,3].map(j=>i+j<s.length?s.charCodeAt(i+j):undefined);if(c[1]!==undefined)a.push(dk[0][c[0]]|dk[1][c[1]]);if(c[2]!==undefined)a.push(dk[2][c[1]]|dk[3][c[2]]);if(c[3]!==undefined)a.push(dk[4][c[2]]|dk[5][c[3]]);}return a; }
function getLens(a,i) { const x=a[i++];let l;if((x&128)===0)l=x;else if((x&192)===128)l=((x&63)<<8)|a[i++];else if((x&224)===192)l=((x&31)<<16)|(a[i++]<<8)|a[i++];else l=x;return[l,i]; }

function extractKeys(cd) {
    const a = decCd(cd); const e = (a[0]<<8|a[1])+2; const s = a.slice(e);
    const o = [s[0]^45, s[1]^2, s[2]^0x36, s[3]^0x34, s[4]^2, s[5]^0x36, s[6]^0x34, s[7]^48];
    const d = s.map((b,i) => b^o[i%8]);
    const k = []; let p = 1;
    for (let i=0; i<d[0]; i++) { const [l,n]=getLens(d,p); p=n; k.push(d.slice(p,p+l)); p+=l; }
    if (k.length < 45) throw new Error('keys 数量不足 ('+k.length+'/45)');
    if ([29,30,31,32].some(i => k[i]?.length !== 4)) throw new Error('keys 结构异常, XOR 偏移可能错误');
    return k;
}

function ascii(a) { return String.fromCharCode(...a); }
function n4(n) { return [(n>>24)&255,(n>>16)&255,(n>>8)&255,n&255]; }

// ============================================================
//  CRC32
// ============================================================
const CRC_T = new Uint32Array(256);
for (let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);CRC_T[i]=c;}
function uuid(d) { if(typeof d==='string')d=unescape(encodeURIComponent(d)).split('').map(c=>c.charCodeAt(0));let c=~0;for(let i=0;i<d.length;i++)c=(c>>>8)^CRC_T[(c^d[i])&0xFF];return(~c)>>>0; }

// ============================================================
//  Huffman
// ============================================================
let huffCfg;
function huffInit() { let a=[];for(let i=1;i<255;i++)a.push({t:1,i});a.push({t:6,i:255},{t:45,i:0});function ins(x){for(let i=0;i<a.length;i++){if(x.t<=a[i].t){a.splice(i,0,x);return}}a.push(x)}while(a.length>1){const[x,y]=a.splice(0,2);ins({t:x.t+y.t,f:x,s:y})}const cfg=[];function walk(n,k=0,v=0){if(n.i!==undefined)cfg[n.i]={k,v};else{walk(n.f,k<<1,v+1);walk(n.s,(k<<1)+1,v+1)}}walk(a[0]);let tk;for(let i in cfg)if(cfg[i].v>=8){tk=cfg[i].k>>(cfg[i].v-8);break}huffCfg=[cfg,tk]; }
function huffEncode(arr) { if(!huffCfg)huffInit();const ans=[];let one=0,two=0;for(let i=0;i<arr.length;i++){const c=huffCfg[0][arr[i]];one=one<<c.v|c.k;two+=c.v;while(two>=8){ans.push(one>>(two-8));one&=~(255<<(two-8));two-=8}}if(two>0)ans.push(one<<(8-two)|huffCfg[1]>>two);return ans; }

// ============================================================
//  AES + Base64
// ============================================================
function aesCBC(data,key,iv) { const p=16-(data.length%16);const padded=Buffer.alloc(data.length+p,p);Buffer.from(data).copy(padded);const c=crypto.createCipheriv('aes-128-cbc',Buffer.from(key),iv||Buffer.alloc(16,0));c.setAutoPadding(false);return iv?[...iv,...Buffer.concat([c.update(padded),c.final()])]:[...Buffer.concat([c.update(padded),c.final()])]; }
function b64Enc(data) { const B='qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d';const r=[];let i=0;const l=data.length-2;while(i<l){const a=data[i++],b=data[i++],c=data[i++];r.push(B[a>>2],B[((a&3)<<4)|(b>>4)],B[((b&15)<<2)|(c>>6)],B[c&63])}if(i<data.length){const a=data[i],b=data[++i];r.push(B[a>>2],B[((a&3)<<4)|(b>>4)]);if(b!==undefined)r.push(B[(b&15)<<2])}return r.join(''); }

// ============================================================
//  codeUid 计算
// ============================================================
function computeCodeUid(coder, keys) {
    const funcIdx = parseInt(ascii(keys[33]));
    const sliceMul = parseInt(ascii(keys[34]));
    const func = coder.functionsNameSort[funcIdx];
    if (!func) return 0;
    const mainCode = coder.code.slice(...coder.mainFunctionIdx);
    const one = uuid(func.code);
    const len = parseInt(mainCode.length / 100);
    const two = uuid(mainCode.substr(len * sliceMul, len));
    return (one ^ two) & 65535;
}

// ============================================================
//  Cookie 生成
// ============================================================
function generateCookie(basearr, keys) {
    const K1 = keys[17], K2 = keys[16], K48 = keys[2];
    const r2t = parseInt(ascii(keys[21]));
    const now = Math.floor(Date.now() / 1000);
    const enc = huffEncode(basearr);
    const xored = enc.slice(); for (let i=0;i<16&&i<xored.length;i++) xored[i]^=K48[i];
    const cipher = aesCBC(xored, K1);
    const cLen = cipher.length;
    const lenE = cLen<128 ? [cLen] : [0x80|(cLen>>8), cLen&0xFF];
    const pkt = [2, 8, ...n4(r2t), ...n4(now), 48, ...K48, ...lenE, ...cipher];
    const crcVal = uuid(pkt);
    const full = [...n4(crcVal), ...pkt];
    const iv = crypto.randomBytes(16);
    return '0' + b64Enc(aesCBC(full, K2, iv));
}

// ============================================================
//  主流程
// ============================================================
async function main() {
    console.log('========================================');
    console.log('  瑞数 Cookie 纯算 (全动态, 零本地依赖)');
    console.log('========================================\n');

    // Step 1: 获取 412 页面
    const r1 = await httpGet(PATH);
    console.log('[1] GET 目标页面:', r1.status);
    if (r1.status !== 412) { console.log('    非 412, 可能不是瑞数保护'); return; }

    const cookieS = (r1.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
    const cdM = r1.body.match(/\$_ts\.cd="([^"]+)"/);
    const nsdM = r1.body.match(/\$_ts\.nsd=(\d+)/);
    if (!cdM || !nsdM) { console.log('    未找到 cd/nsd'); return; }
    const cd = cdM[1], nsd = parseInt(nsdM[1]);
    console.log('    cd:', cd.length, 'chars, nsd:', nsd);

    // Step 2: 获取 mainjs (优先用缓存, 否则从 412 HTML 提取 URL 下载)
    const cacheFile = path.join(__dirname, '../captured/mainjs.js');
    let mainjs;
    if (fs.existsSync(cacheFile)) {
        mainjs = fs.readFileSync(cacheFile, 'utf-8');
        console.log('[2] mainjs: 使用缓存', mainjs.length, 'chars');
    } else {
        const jsUrlM = r1.body.match(/src="([^"]+\.js)"/);
        if (!jsUrlM) { console.log('    未找到 mainjs URL'); return; }
        console.log('[2] 下载 mainjs:', jsUrlM[1]);
        const r2 = await httpGet(jsUrlM[1]);
        if (r2.status !== 200) { console.log('    下载失败:', r2.status); return; }
        mainjs = r2.body;
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, mainjs);
        console.log('    已缓存:', mainjs.length, 'chars');
    }

    // Step 3: 提取 keys
    const keys = extractKeys(cd);
    const k7 = ascii(keys[7]).split(';');
    const cookieName = k7[5] + 'T';
    console.log('[3] Keys:', keys.length, '组, Cookie:', cookieName);

    // Step 4: Coder 重写外层 VM → codeUid
    const coder = new Coder(nsd, cd, mainjs);
    coder.run();
    const codeUid = computeCodeUid(coder, keys);
    console.log('[4] Coder: eval', coder.code.length, 'chars, codeUid:', codeUid);

    // Step 5: 生成 basearr
    const cp1 = grenKeys(coder.keynameNum, nsd);
    const config = {
        userAgent: UA,
        pathname: PATH,
        hostname: HOST,
        platform: 'MacIntel',
        execNumberByTime: 1600,
        randomAvg: [50, 8],
        innerHeight: 768, innerWidth: 1024,
        outerHeight: 768, outerWidth: 1024,
        documentHidden: false,
        flag: 2830,
        codeUid,
        _cp1: cp1,
        runTime: Math.floor(Date.now() / 1000),
        startTime: Math.floor(Date.now() / 1000) - 1,
        currentTime: Date.now(),
    };
    const basearr = buildBasearr(config, keys);
    console.log('[5] basearr:', basearr.length, 'B');

    // Step 6: 加密生成 Cookie T
    const cookieValue = generateCookie(basearr, keys);
    console.log('[6] Cookie T:', cookieValue.length, 'chars');

    // Step 7: 验证
    const allCookies = [cookieS, cookieName + '=' + cookieValue].filter(Boolean).join('; ');
    const r3 = await httpGet(PATH, allCookies);
    console.log('\n[7] 验证:', r3.status);
    if (r3.status === 200) {
        console.log('    Cookie 验证通过');
        console.log('    页面:', r3.body.length, 'chars');
    } else {
        console.log('    失败:', r3.status);
    }
    console.log('\n========================================');
}

main().catch(e => console.error('错误:', e.message));
