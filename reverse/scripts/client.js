/**
 * 瑞数纯算客户端 — 支持 Cookie 自动更新
 *
 * 每次请求前自动检查 Cookie 是否有效:
 *   - 新 session: 获取 412 → 生成 Cookie T
 *   - Cookie 过期 (412/400): 自动重新获取
 *
 * 用法:
 *   const client = new RuishuPureClient({ host, port, entryPath });
 *   await client.init();
 *   const page = await client.get('/path');
 *   const data = await client.post('/api', 'key=value');
 *   // 如果 Cookie 过期, 自动重新获取, 无需手动处理
 */
const crypto = require('crypto');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Coder, grenKeys } = require('./coder.js');
const { buildBasearr } = require('./basearr.js');

const BASESTR = 'qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d{}|~ !#$%()*+,-;=?@[]^';

// === 加密工具 ===
function mkDK(){const a=[{},{},{},{},{},{}];for(let i=0;i<BASESTR.length;i++){const c=BASESTR.charCodeAt(i);a[0][c]=i<<2;a[1][c]=i>>4;a[2][c]=(i&15)<<4;a[3][c]=i>>2;a[4][c]=(i&3)<<6;a[5][c]=i;}return a;}
function decCd(s){const dk=mkDK();const a=[];for(let i=0;i<s.length;i+=4){const c=[0,1,2,3].map(j=>i+j<s.length?s.charCodeAt(i+j):undefined);if(c[1]!==undefined)a.push(dk[0][c[0]]|dk[1][c[1]]);if(c[2]!==undefined)a.push(dk[2][c[1]]|dk[3][c[2]]);if(c[3]!==undefined)a.push(dk[4][c[2]]|dk[5][c[3]]);}return a;}
function getLens(a,i){const x=a[i++];let l;if((x&128)===0)l=x;else if((x&192)===128)l=((x&63)<<8)|a[i++];else if((x&224)===192)l=((x&31)<<16)|(a[i++]<<8)|a[i++];else l=x;return[l,i];}
function extractKeys(cd){const a=decCd(cd);const e=(a[0]<<8|a[1])+2;const s=a.slice(e);const o=[s[0]^45,s[1]^2,s[2]^0x36,s[3]^0x34,s[4]^2,s[5]^0x36,s[6]^0x34,s[7]^48];const d=s.map((b,i)=>b^o[i%8]);const k=[];let p=1;for(let i=0;i<d[0];i++){const[l,n]=getLens(d,p);p=n;k.push(d.slice(p,p+l));p+=l;}return k;}
const CRC_T=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);CRC_T[i]=c;}
function crc32(d){if(typeof d==='string')d=unescape(encodeURIComponent(d)).split('').map(c=>c.charCodeAt(0));let c=~0;for(let i=0;i<d.length;i++)c=(c>>>8)^CRC_T[(c^d[i])&0xFF];return(~c)>>>0;}
let huffCfg;function huffInit(){let a=[];for(let i=1;i<255;i++)a.push({t:1,i});a.push({t:6,i:255},{t:45,i:0});function ins(x){for(let i=0;i<a.length;i++){if(x.t<=a[i].t){a.splice(i,0,x);return}}a.push(x)}while(a.length>1){const[x,y]=a.splice(0,2);ins({t:x.t+y.t,f:x,s:y})}const cfg=[];function walk(n,k=0,v=0){if(n.i!==undefined)cfg[n.i]={k,v};else{walk(n.f,k<<1,v+1);walk(n.s,(k<<1)+1,v+1)}}walk(a[0]);let tk;for(let i in cfg)if(cfg[i].v>=8){tk=cfg[i].k>>(cfg[i].v-8);break}huffCfg=[cfg,tk];}
function huffEncode(arr){if(!huffCfg)huffInit();const ans=[];let one=0,two=0;for(let i=0;i<arr.length;i++){const c=huffCfg[0][arr[i]];one=one<<c.v|c.k;two+=c.v;while(two>=8){ans.push(one>>(two-8));one&=~(255<<(two-8));two-=8}}if(two>0)ans.push(one<<(8-two)|huffCfg[1]>>two);return ans;}
function aesCBC(data,key,iv){const p=16-(data.length%16);const padded=Buffer.alloc(data.length+p,p);Buffer.from(data).copy(padded);const c=crypto.createCipheriv('aes-128-cbc',Buffer.from(key),iv||Buffer.alloc(16,0));c.setAutoPadding(false);return iv?[...iv,...Buffer.concat([c.update(padded),c.final()])]:[...Buffer.concat([c.update(padded),c.final()])];}
function b64Enc(data){const B='qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d';const r=[];let i=0;const l=data.length-2;while(i<l){const a=data[i++],b=data[i++],c=data[i++];r.push(B[a>>2],B[((a&3)<<4)|(b>>4)],B[((b&15)<<2)|(c>>6)],B[c&63])}if(i<data.length){const a=data[i],b=data[++i];r.push(B[a>>2],B[((a&3)<<4)|(b>>4)]);if(b!==undefined)r.push(B[(b&15)<<2])}return r.join('')}
function n4(n){return[(n>>24)&255,(n>>16)&255,(n>>8)&255,n&255];}
function computeCodeUid(coder,keys){const funcIdx=parseInt(String.fromCharCode(...keys[33]));const sliceMul=parseInt(String.fromCharCode(...keys[34]));const func=coder.functionsNameSort[funcIdx];if(!func)return 0;const mainCode=coder.code.slice(...coder.mainFunctionIdx);const one=crc32(func.code);const len=parseInt(mainCode.length/100);const two=crc32(mainCode.substr(len*sliceMul,len));return(one^two)&65535;}
function generateCookie(ba,keys){const K1=keys[17],K2=keys[16],K48=keys[2];const r2t=parseInt(String.fromCharCode(...keys[21]));const now=Math.floor(Date.now()/1000);const enc=huffEncode(ba);const xored=enc.slice();for(let i=0;i<16&&i<xored.length;i++)xored[i]^=K48[i];const cipher=aesCBC(xored,K1);const cLen=cipher.length;const lenE=cLen<128?[cLen]:[0x80|(cLen>>8),cLen&0xFF];const pkt=[2,8,...n4(r2t),...n4(now),48,...K48,...lenE,...cipher];const crcVal=crc32(pkt);const full=[...n4(crcVal),...pkt];const iv=crypto.randomBytes(16);return '0'+b64Enc(aesCBC(full,K2,iv));}

// ============================================================
//  RuishuPureClient
// ============================================================
class RuishuPureClient {
    constructor(config = {}) {
        this.host = config.host || '202.127.48.145';
        this.port = config.port || 8888;
        this.entryPath = config.entryPath || '/zscq/search/jsp/vBrandSearchIndex.jsp';
        this.ua = config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
        this.platform = config.platform || 'Win32';
        this.flag = config.flag || 2830;

        // session 状态
        this._cookieS = null;
        this._cookieT = null;
        this._cookieName = null;
        this._keys = null;
        this._mainjs = null;
        this._createdAt = 0;
    }

    // 获取新 session (412 → Cookie S + Cookie T)
    async _newSession() {
        // 1. GET 412
        const r1 = await this._http('GET', this.entryPath);
        if (r1.status !== 412) throw new Error('非 412: ' + r1.status);

        this._cookieS = (r1.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
        const cd = r1.body.match(/\$_ts\.cd="([^"]+)"/)?.[1];
        const nsd = parseInt(r1.body.match(/\$_ts\.nsd=(\d+)/)?.[1]);
        if (!cd || !nsd) throw new Error('未找到 cd/nsd');

        // 2. 下载 mainjs (缓存)
        if (!this._mainjs) {
            const jsUrl = r1.body.match(/src="([^"]+\.js)"/)?.[1];
            if (!jsUrl) throw new Error('未找到 mainjs URL');
            const r2 = await this._http('GET', jsUrl);
            this._mainjs = r2.body;
        }

        // 3. keys + Coder + basearr + Cookie T
        this._keys = extractKeys(cd);
        const k7 = String.fromCharCode(...this._keys[7]).split(';');
        this._cookieName = k7[5] + 'T';

        const coder = new Coder(nsd, cd, this._mainjs);
        coder.run();
        const codeUid = computeCodeUid(coder, this._keys);
        const cp1 = grenKeys(coder.keynameNum, nsd);

        const basearr = buildBasearr({
            userAgent: this.ua, pathname: this.entryPath, hostname: this.host,
            platform: this.platform, flag: this.flag, codeUid,
            execNumberByTime: 1600, randomAvg: [50, 8],
            innerHeight: 768, innerWidth: 1024,
            outerHeight: 768, outerWidth: 1024,
            documentHidden: false, _cp1: cp1,
            runTime: Math.floor(Date.now() / 1000),
            startTime: Math.floor(Date.now() / 1000) - 1,
            currentTime: Date.now(),
        }, this._keys);

        this._cookieT = generateCookie(basearr, this._keys);
        this._createdAt = Date.now();
    }

    // 获取当前 Cookie 字符串
    _getCookie() {
        return [this._cookieS, this._cookieName + '=' + this._cookieT].filter(Boolean).join('; ');
    }

    // 检查 session 是否可能过期 (超过 5 分钟自动刷新)
    _isExpired() {
        return !this._cookieS || !this._cookieT || (Date.now() - this._createdAt > 5 * 60 * 1000);
    }

    // 初始化 (首次获取 session)
    async init() {
        await this._newSession();
        return this;
    }

    // GET 请求 (自动重试)
    async get(urlPath) {
        if (this._isExpired()) await this._newSession();

        const r = await this._http('GET', urlPath, this._getCookie());
        if (r.status === 412 || r.status === 400) {
            // Cookie 过期, 重新获取
            await this._newSession();
            return this._http('GET', urlPath, this._getCookie());
        }
        return r;
    }

    // POST 请求 (每次用新鲜 Cookie, 自动重试)
    async post(urlPath, body) {
        // POST 对 Cookie 要求更严格, 每次用新 session
        await this._newSession();
        return this._http('POST', urlPath, this._getCookie(), body);
    }

    // 底层 HTTP
    _http(method, urlPath, cookie, body) {
        return new Promise((resolve, reject) => {
            const headers = {
                'User-Agent': this.ua,
                'Host': `${this.host}:${this.port}`,
            };
            if (cookie) headers['Cookie'] = cookie;
            if (body) {
                headers['Content-Type'] = 'application/x-www-form-urlencoded';
                headers['Content-Length'] = Buffer.byteLength(body);
            }
            const req = http.request({
                hostname: this.host, port: this.port,
                path: urlPath, method, headers,
            }, res => {
                const chunks = [];
                res.on('data', d => chunks.push(d));
                res.on('end', () => resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(chunks).toString('utf-8'),
                }));
            });
            req.on('error', reject);
            if (body) req.write(body);
            req.end();
        });
    }
}

// ============================================================
//  Demo
// ============================================================
async function demo() {
    console.log('========================================');
    console.log('  瑞数纯算客户端');
    console.log('========================================\n');

    const client = new RuishuPureClient();
    await client.init();
    console.log('[init] Cookie 就绪\n');

    // GET
    const page = await client.get('/zscq/search/jsp/vBrandSearchIndex.jsp');
    console.log('[GET] 主页:', page.status, page.body.length, 'chars');

    // POST 查询
    const r1 = await client.post(
        '/searchUser/searchAction!getVRecordListPage.do',
        'page=1&rows=5&sidx=RECORD_NUM&sord=desc&_search=false&nd=' + Date.now()
    );
    console.log('[POST] 查询:', r1.status);
    if (r1.status === 200) {
        const data = JSON.parse(r1.body);
        console.log('  总记录:', data.records, '本页:', data.rows?.length, '条');
        data.rows?.slice(0, 3).forEach((row, i) => {
            console.log(`  [${i+1}] ${row.APPLY_USER_NAME} | ${row.REGISTER_NUM} | ${row.RECORD_NUM}`);
        });
    }

    // POST 搜索
    const r2 = await client.post(
        '/searchUser/searchAction!getVRecordListPage.do',
        'page=1&rows=5&sidx=RECORD_NUM&sord=desc&RECORD_NAME=' + encodeURIComponent('华为') + '&_search=false&nd=' + Date.now()
    );
    console.log('\n[POST] 搜索"华为":', r2.status);
    if (r2.status === 200) {
        const data = JSON.parse(r2.body);
        console.log('  结果:', data.records, '条');
        data.rows?.forEach((row, i) => {
            console.log(`  [${i+1}] ${row.APPLY_USER_NAME} | ${row.REGISTER_NUM} | ${row.RECORD_NUM}`);
        });
    }

    // POST 翻页
    const r3 = await client.post(
        '/searchUser/searchAction!getVRecordListPage.do',
        'page=2&rows=5&sidx=RECORD_NUM&sord=desc&_search=false&nd=' + Date.now()
    );
    console.log('\n[POST] 第2页:', r3.status);
    if (r3.status === 200) {
        const data = JSON.parse(r3.body);
        data.rows?.forEach((row, i) => {
            console.log(`  [${i+1}] ${row.APPLY_USER_NAME} | ${row.REGISTER_NUM}`);
        });
    }

    console.log('\n========================================');
}

if (require.main === module) demo().catch(e => console.error('错误:', e.message));
module.exports = { RuishuPureClient };
