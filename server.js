require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 8080;

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());

const limiter = rateLimit({ windowMs: 60 * 1000, max: 30, trustProxy: true });
app.use('/api/', limiter);

// Cache
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000;
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of cache.entries()) {
        if (now - v.timestamp > CACHE_TTL) cache.delete(k);
    }
}, 5 * 60 * 1000);

// Logs
let eventLogs = [];
const MAX_LOGS = 100;
function addLog(level, message) {
    const entry = { timestamp: new Date().toISOString(), level, message };
    eventLogs.unshift(entry);
    if (eventLogs.length > MAX_LOGS) eventLogs.pop();
    console.log(`[${level.toUpperCase()}] ${message}`);
}

// Browser Manager with stealth
let browserInstance = null;
async function getBrowser() {
    if (browserInstance && browserInstance.isConnected()) return browserInstance;
    addLog('info', '🚀 تشغيل Chromium...');
    browserInstance = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });
    addLog('info', '✅ Chromium جاهز');
    return browserInstance;
}

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
];

function randomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ========== وظيفة استخراج الرابط الرئيسية (محسنة) ==========
async function extractDirectLink(url, retry = 0) {
    const start = Date.now();
    addLog('info', `🌐 استخراج: ${url} (محاولة ${retry+1})`);
    let browser, context, page;
    try {
        browser = await getBrowser();
        context = await browser.newContext({
            userAgent: randomUserAgent(),
            viewport: { width: 1280, height: 720 },
            locale: 'en-US',
            extraHTTPHeaders: {
                'Accept-Language': 'en-US,en;q=0.9',
                'Sec-Ch-Ua': '"Chromium";v="122"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Fetch-Dest': 'document'
            }
        });
        // إخفاء webdriver
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            window.chrome = { runtime: {} };
        });
        page = await context.newPage();

        // 1. انتقل إلى صفحة MediaFire
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        // 2. انتظر ظهور زر التحميل الرئيسي
        const downloadBtn = await page.waitForSelector('a#downloadButton, a.downloadButton, a#download_link', { timeout: 10000 });
        if (!downloadBtn) throw new Error('زر التحميل غير موجود');

        // 3. اضغط على الزر – قد يبدأ تحميل مباشر أو إعادة توجيه
        await downloadBtn.click();
        addLog('info', '🖱️ تم النقر على زر التحميل');

        // 4. انتظر حتى يبدأ التنقل (قد ينتقل إلى صفحة أخرى أو يبدأ التحميل)
        // الطريقة الأولى: انتظر حتى يغير المتصفح URL
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
        
        let directLink = null;
        const currentUrl = page.url();
        addLog('info', `📍 الرابط الحالي بعد النقر: ${currentUrl.substring(0, 80)}`);

        // 5. تحقق إذا كان الرابط الحالي من نوع download.mediafire.com
        if (currentUrl.includes('download.mediafire.com')) {
            directLink = currentUrl;
        }
        // 6. إذا كان الرابط الحالي هو صفحة repair أو verify، حاول استخراج الرابط من الصفحة
        else if (currentUrl.includes('download_repair') || currentUrl.includes('verify')) {
            // قد يكون هناك رابط تحميل بديل مخفي في الصفحة
            directLink = await page.evaluate(() => {
                // البحث عن أي رابط يحتوي على download.mediafire.com
                const links = Array.from(document.querySelectorAll('a[href*="download.mediafire.com"]'));
                if (links.length) return links[0].href;
                // البحث داخل النصوص
                const bodyText = document.body.innerText;
                const match = bodyText.match(/https:\/\/download\d+\.mediafire\.com\/[^\s"]+/);
                return match ? match[0] : null;
            });
        }

        // 7. إذا لم نجد الرابط بعد، ننتظر استجابة الشبكة التي تحتوي على download.mediafire.com
        if (!directLink) {
            addLog('info', '⏳ انتظار استجابة شبكة تحتوي على download.mediafire.com...');
            const downloadResponse = await page.waitForResponse(
                response => response.url().includes('download.mediafire.com') && response.status() === 200,
                { timeout: 15000 }
            ).catch(() => null);
            if (downloadResponse) {
                directLink = downloadResponse.url();
            }
        }

        // 8. إذا لم ينجح أي شيء، جرب قراءة الرابط من localStorage أو sessionStorage
        if (!directLink) {
            directLink = await page.evaluate(() => {
                // بعض الأحيان يخزن MediaFire الرابط في localStorage
                const storage = window.localStorage.getItem('download_link') || window.sessionStorage.getItem('download_link');
                if (storage) return storage;
                return null;
            });
        }

        await page.close();
        await context.close();

        if (directLink && directLink.includes('download.mediafire.com') && !directLink.includes('repair')) {
            addLog('success', `✅ تم الاستخراج (${Date.now()-start}ms): ${directLink.substring(0,80)}...`);
            return { success: true, directLink, timestamp: Date.now() };
        } else {
            throw new Error(`لم يتم العثور على رابط تحميل صالح. الرابط الحالي: ${currentUrl}`);
        }
    } catch (err) {
        addLog('error', `❌ فشل: ${err.message}`);
        if (page) await page.close().catch(()=>{});
        if (context) await context.close().catch(()=>{});
        if (retry < 2) {
            addLog('warn', `🔄 إعادة المحاولة بعد ${2 * (retry+1)} ثوانٍ...`);
            await new Promise(r => setTimeout(r, 2000 * (retry+1)));
            return extractDirectLink(url, retry + 1);
        }
        return { success: false, error: err.message };
    }
}

// API endpoints
app.post('/api/extract', async (req, res) => {
    const { url } = req.body;
    if (!url || !url.includes('mediafire.com')) {
        return res.status(400).json({ success: false, error: 'رابط MediaFire غير صالح' });
    }
    const cached = cache.get(url);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        addLog('cache', `📦 كاش: ${url}`);
        return res.json({ ...cached, cached: true });
    }
    const result = await extractDirectLink(url);
    if (result.success) cache.set(url, result);
    res.json(result);
});

app.get('/api/logs', (req, res) => res.json({ logs: eventLogs }));
app.get('/api/health', (req, res) => res.json({ status: 'healthy', cacheSize: cache.size }));

// صفحة HTML (نفس السابقة ولكن مع رسالة خطأ أوضح)
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>MediaFire Extractor Pro</title><style>
body{background:#1e1e2f;color:#eee;font-family:sans-serif;padding:20px}
.container{max-width:800px;margin:0 auto}
.card{background:#2d2d3a;border-radius:12px;padding:20px;margin-bottom:20px}
input,button{padding:12px;font-size:16px;border-radius:8px;border:none}
input{flex:1;background:#3a3a4a;color:#fff}
button{background:#ff9800;cursor:pointer}
.flex{display:flex;gap:12px}
.result{background:#0a0a12;padding:16px;border-radius:8px;word-break:break-all;margin-top:16px}
.log-panel{background:#0a0a12;height:300px;overflow:auto;font-family:monospace;font-size:12px;padding:12px}
.log-info{color:#4caf50}
.log-error{color:#f44336}
.log-success{color:#8bc34a}
video{max-width:100%; margin-top:16px}
</style></head>
<body>
<div class=container>
<h1>🎬 MediaFire Direct Link Extractor Pro</h1>
<div class=card>
<div class=flex><input type=text id=urlInput placeholder="MediaFire URL"><button id=extractBtn>🚀 استخراج</button></div>
<div id=resultArea class=result style=display:none></div>
<div id=videoPlayer style=display:none></div>
</div>
<div class=card><h3>📋 سجل الخادم (مباشر)</h3><div id=logPanel class=log-panel></div>
<p style="font-size:11px; color:#aaa;">ملاحظة: إذا ظهر رابط repair، فهذا يعني أن MediaFire طلب تحققاً بشرياً بسبب IP السحابي. المحاولة التالية قد تنجح.</p>
</div>
</div>
<script>
const urlInput=document.getElementById('urlInput'),extractBtn=document.getElementById('extractBtn'),resultArea=document.getElementById('resultArea'),videoPlayer=document.getElementById('videoPlayer'),logPanel=document.getElementById('logPanel');
let lastLogCount=0;
async function fetchLogs(){
    try{
        const res=await fetch('/api/logs'),data=await res.json();
        if(!data.logs)return;
        if(data.logs.length===lastLogCount)return;
        lastLogCount=data.logs.length;
        logPanel.innerHTML=data.logs.map(log=>{
            let cls=log.level==='error'?'log-error':log.level==='success'?'log-success':'log-info';
            return '<div><span class="'+cls+'">['+log.level.toUpperCase()+']</span> '+new Date(log.timestamp).toLocaleTimeString()+' - '+escapeHtml(log.message)+'</div>';
        }).join('');
        logPanel.scrollTop=logPanel.scrollHeight;
    }catch(e){}
}
function escapeHtml(str){return str.replace(/[&<>]/g,function(m){if(m==='&')return'&amp;';if(m==='<')return'&lt;';if(m==='>')return'&gt;';return m;});}
async function extract(){
    const url=urlInput.value.trim();
    if(!url)return alert('أدخل رابط MediaFire');
    if(!url.includes('mediafire.com'))return alert('رابط غير صالح');
    resultArea.style.display='block';
    resultArea.innerHTML='⏳ جاري الاستخراج... قد يستغرق 30 ثانية';
    videoPlayer.style.display='none';
    try{
        const res=await fetch('/api/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
        const data=await res.json();
        if(data.success&&data.directLink&&data.directLink.includes('download.mediafire.com')){
            const link=data.directLink;
            resultArea.innerHTML='<strong>✅ الرابط المباشر:</strong><br><a href="'+link+'" target="_blank">'+link+'</a><br>'+(data.cached?'📦 من الكاش':'✨ تم الاستخراج')+'<br><button id="copyBtn">نسخ الرابط</button>';
            videoPlayer.style.display='block';
            videoPlayer.innerHTML='<video controls autoplay style="width:100%"><source src="'+link+'" type="video/mp4"></video>';
            document.getElementById('copyBtn')?.addEventListener('click',()=>{navigator.clipboard.writeText(link);alert('تم النسخ');});
        }else{
            resultArea.innerHTML='<strong>❌ فشل:</strong> '+(data.error||'الرابط غير صالح أو تم تحويله إلى صفحة تحقق')+'<br><br>⚠️ قد يكون MediaFire طلب تحققاً بشرياً (CAPTCHA). حاول مرة أخرى بعد دقيقة.';
        }
    }catch(err){resultArea.innerHTML='<strong>❌ خطأ:</strong> '+err.message;}
}
extractBtn.onclick=extract;
urlInput.onkeypress=e=>{if(e.key==='Enter')extract();};
setInterval(fetchLogs,800);
fetchLogs();
</script>
</body></html>`);
});

process.on('SIGTERM', async () => { if (browserInstance) await browserInstance.close(); process.exit(0); });
process.on('SIGINT', async () => { if (browserInstance) await browserInstance.close(); process.exit(0); });

app.listen(PORT, '0.0.0.0', () => addLog('info', `🚀 السيرفر يعمل على المنفذ ${PORT}`));
