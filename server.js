require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { chromium } = require('playwright');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8080;

app.set('trust proxy', 1);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiter للـ API
const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    trustProxy: true,
    keyGenerator: (req) => req.ip || req.connection.remoteAddress,
});
app.use('/api/', limiter);

// ========== الكاش ==========
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000;
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of cache.entries()) {
        if (now - v.timestamp > CACHE_TTL) cache.delete(k);
    }
}, 5 * 60 * 1000);

// ========== السجل المباشر ==========
let eventLogs = [];
const MAX_LOGS = 100;
function addLog(level, message, meta = {}) {
    const entry = { timestamp: new Date().toISOString(), level, message, ...meta };
    eventLogs.unshift(entry);
    if (eventLogs.length > MAX_LOGS) eventLogs.pop();
    console.log(`[${level.toUpperCase()}] ${message}`);
}

// ========== قائمة User-Agents حقيقية ==========
const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.2365.66'
];

function randomUserAgent() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function randomViewport() {
    const widths = [1280, 1366, 1440, 1536, 1600, 1920];
    const heights = [720, 768, 800, 864, 900, 1080];
    return {
        width: widths[Math.floor(Math.random() * widths.length)],
        height: heights[Math.floor(Math.random() * heights.length)]
    };
}

// ========== مدير المتصفح مع تدوير الهوية ==========
let browserInstance = null;
let currentProxy = process.env.PROXY_URL || null;

async function getBrowser(forceNew = false) {
    if (forceNew || !browserInstance || !browserInstance.isConnected()) {
        if (browserInstance) {
            await browserInstance.close().catch(() => {});
        }
        const args = [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
            '--disable-features=IsolateOrigins,site-per-process'
        ];
        if (currentProxy) {
            args.push(`--proxy-server=${currentProxy}`);
            addLog('info', `🔒 استخدام بروكسي: ${currentProxy}`);
        }
        browserInstance = await chromium.launch({
            headless: true,
            args: args
        });
        addLog('info', '✅ متصفح جديد تم تشغيله');
    }
    return browserInstance;
}

// دالة لتأخير عشوائي (محاكاة التفكير البشري)
function randomDelay(min = 500, max = 2500) {
    return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
}

// استخراج الرابط مع سلوك بشري متقدم
async function extractDirectLink(url, retry = 0) {
    const start = Date.now();
    addLog('info', `🌐 استخراج: ${url} (محاولة ${retry+1})`);
    let browser = null;
    let context = null;
    let page = null;
    try {
        browser = await getBrowser(retry > 0); // إذا كانت محاولة >0 نستخدم متصفح جديد
        const userAgent = randomUserAgent();
        const viewport = randomViewport();
        
        context = await browser.newContext({
            userAgent: userAgent,
            viewport: viewport,
            locale: 'en-US',
            timezoneId: 'America/New_York',
            permissions: ['geolocation'],
            geolocation: { longitude: -74.006, latitude: 40.7128 },
            extraHTTPHeaders: {
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'document',
                'Sec-Fetch-Mode': 'navigate',
                'Sec-Fetch-Site': 'none',
                'Upgrade-Insecure-Requests': '1'
            }
        });
        
        // إخفاء علامات الأتمتة
        await context.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3] });
            window.chrome = { runtime: {} };
            // إضافة canvas fingerprint عشوائي
            const originalGetContext = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(type, ...args) {
                if (type === '2d') {
                    const ctx = originalGetContext.call(this, type, ...args);
                    const originalFillText = ctx.fillText;
                    ctx.fillText = function(text, x, y, ...rest) {
                        const randomOffset = Math.random() * 0.01;
                        return originalFillText.call(this, text, x + randomOffset, y + randomOffset, ...rest);
                    };
                    return ctx;
                }
                return originalGetContext.call(this, type, ...args);
            };
        });
        
        page = await context.newPage();
        
        // محاكاة حركة الماوس والتمرير قبل التنقل (سلوك بشري)
        await page.mouse.move(Math.random() * 500, Math.random() * 400);
        await randomDelay(300, 800);
        
        addLog('info', `🚀 جاري تحميل الصفحة باستخدام User-Agent: ${userAgent.substring(0, 50)}...`);
        await page.goto(url, { waitUntil: 'networkidle', timeout: 35000 });
        
        // انتظر قليلاً لمحاكاة القراءة
        await randomDelay(1000, 3000);
        
        // التمرير لأسفل ثم لأعلى
        await page.evaluate(() => window.scrollBy(0, Math.random() * 500 + 200));
        await randomDelay(500, 1000);
        await page.evaluate(() => window.scrollTo(0, 0));
        await randomDelay(300, 600);
        
        // البحث عن زر التحميل والنقر عليه (محاكاة تفاعل بشري)
        const downloadBtn = await page.waitForSelector('a#downloadButton, a.downloadButton, a#download_link, a[aria-label="Download file"]', { timeout: 15000 }).catch(() => null);
        let directLink = null;
        
        if (downloadBtn) {
            // تحريك الماوس إلى الزر قبل النقر
            const box = await downloadBtn.boundingBox();
            if (box) {
                await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
                await randomDelay(200, 500);
            }
            // محاولة النقر
            await downloadBtn.click();
            addLog('info', '🖱️ تم النقر على زر التحميل');
            await randomDelay(2000, 4000);
            
            // بعد النقر، قد يتغير الرابط أو تبدأ عملية التحميل
            const currentUrl = page.url();
            if (currentUrl !== url && (currentUrl.includes('download') || currentUrl.includes('mediafire'))) {
                directLink = currentUrl;
            } else {
                // البحث عن الرابط الجديد في الصفحة
                directLink = await page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a[href*="download"]'));
                    for (let link of links) {
                        if (link.href && (link.href.includes('download.mediafire.com') || link.href.includes('mediafire.com/download'))) {
                            return link.href;
                        }
                    }
                    return null;
                });
            }
        }
        
        // إذا لم نجد الرابط بعد النقر، نبحث في الـ HTML
        if (!directLink) {
            directLink = await page.evaluate(() => {
                // البحث في النصوص البرمجية
                const scripts = Array.from(document.querySelectorAll('script'));
                for (let script of scripts) {
                    const content = script.innerHTML;
                    const match = content.match(/["'](https:\/\/download\d+\.mediafire\.com\/[a-f0-9]+\/[^"']+)["']/);
                    if (match) return match[1];
                }
                // البحث عن أي رابط يحتوي على download.mediafire.com
                const links = Array.from(document.querySelectorAll('a[href*="download.mediafire.com"]'));
                if (links.length) return links[0].href;
                return null;
            });
        }
        
        if (!directLink && page.url().includes('download')) {
            directLink = page.url();
        }
        
        await page.close();
        await context.close();
        
        if (directLink && !directLink.includes('verify') && !directLink.includes('human')) {
            addLog('success', `✅ تم الاستخراج (${Date.now()-start}ms): ${directLink.substring(0,80)}...`);
            return { success: true, directLink, timestamp: Date.now() };
        } else {
            // إذا كان الرابط يحتوي على verify أو human، يعني CAPTCHA
            if (directLink && (directLink.includes('verify') || directLink.includes('human'))) {
                throw new Error('CAPTCHA detected - MediaFire requires human verification');
            } else {
                throw new Error('No valid download link found');
            }
        }
    } catch (err) {
        const errorMsg = err.message;
        addLog('error', `❌ فشل: ${errorMsg}`);
        
        // إعادة المحاولة إذا كان الخطأ بسبب CAPTCHA أو إغلاق المتصفح
        if (errorMsg.includes('CAPTCHA') || errorMsg.includes('closed') || errorMsg.includes('Timeout')) {
            if (retry < 2) {
                addLog('warn', '🔄 إعادة المحاولة بمتصفح جديد بعد 3 ثوانٍ...');
                await randomDelay(3000, 5000);
                // إجبار إنشاء متصفح جديد
                await getBrowser(true);
                return extractDirectLink(url, retry + 1);
            }
        } else if (retry < 1) {
            await randomDelay(2000, 4000);
            return extractDirectLink(url, retry + 1);
        }
        return { success: false, error: errorMsg };
    }
}

// ========== API ==========
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

app.get('/api/logs', (req, res) => {
    res.json({ logs: eventLogs });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', cacheSize: cache.size, logsCount: eventLogs.length });
});

// ========== صفحة HTML (نفس السابقة مع تحديث) ==========
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MediaFire Link Extractor - Advanced</title>
    <style>
        * { box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #1e1e2f; color: #eee; margin: 0; padding: 20px; }
        .container { max-width: 1200px; margin: 0 auto; }
        h1 { color: #ff9800; }
        .card { background: #2d2d3a; border-radius: 12px; padding: 20px; margin-bottom: 20px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
        input, button { padding: 12px 16px; font-size: 16px; border-radius: 8px; border: none; }
        input { flex: 1; background: #3a3a4a; color: white; margin-right: 12px; }
        button { background: #ff9800; color: #1e1e2f; cursor: pointer; font-weight: bold; transition: 0.2s; }
        button:hover { background: #e68900; }
        .flex { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
        .result { background: #0a0a12; padding: 16px; border-radius: 8px; font-family: monospace; word-break: break-all; margin-top: 16px; border-left: 4px solid #ff9800; }
        video { width: 100%; max-height: 400px; background: black; border-radius: 8px; margin-top: 16px; }
        .log-panel { background: #0a0a12; height: 300px; overflow-y: auto; font-family: monospace; font-size: 12px; padding: 12px; border-radius: 8px; }
        .log-entry { border-bottom: 1px solid #2d2d3a; padding: 4px 0; }
        .log-info { color: #4caf50; }
        .log-error { color: #f44336; }
        .log-cache { color: #2196f3; }
        .log-success { color: #8bc34a; }
        .status { display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: #4caf50; margin-right: 8px; animation: pulse 1.5s infinite; }
        @keyframes pulse { 0% { opacity: 0.4; } 100% { opacity: 1; } }
        a { color: #ff9800; }
    </style>
</head>
<body>
<div class="container">
    <h1>🎬 MediaFire Direct Link Extractor <span class="status"></span></h1>
    <div class="card">
        <div class="flex">
            <input type="text" id="urlInput" placeholder="https://www.mediafire.com/file/..." autocomplete="off">
            <button id="extractBtn">🚀 استخراج الرابط</button>
        </div>
        <div id="resultArea" class="result" style="display:none;"></div>
        <div id="videoPlayer" style="display:none;"></div>
    </div>
    <div class="card">
        <h3>📋 سجل الخادم (مباشر)</h3>
        <div id="logPanel" class="log-panel"></div>
    </div>
</div>
<script>
    const extractBtn = document.getElementById('extractBtn');
    const urlInput = document.getElementById('urlInput');
    const resultArea = document.getElementById('resultArea');
    const videoPlayer = document.getElementById('videoPlayer');
    const logPanel = document.getElementById('logPanel');
    let lastLogCount = 0;

    async function fetchLogs() {
        try {
            const res = await fetch('/api/logs');
            const data = await res.json();
            if (!data.logs) return;
            if (data.logs.length === lastLogCount) return;
            lastLogCount = data.logs.length;
            logPanel.innerHTML = data.logs.map(log => {
                let cls = 'log-info';
                if (log.level === 'error') cls = 'log-error';
                else if (log.level === 'cache') cls = 'log-cache';
                else if (log.level === 'success') cls = 'log-success';
                return '<div class="log-entry"><span class="'+cls+'">['+log.level.toUpperCase()+']</span> '+new Date(log.timestamp).toLocaleTimeString()+' - '+escapeHtml(log.message)+'</div>';
            }).join('');
            logPanel.scrollTop = logPanel.scrollHeight;
        } catch(e) {}
    }

    function escapeHtml(str) {
        return str.replace(/[&<>]/g, function(m) {
            if (m === '&') return '&amp;';
            if (m === '<') return '&lt;';
            if (m === '>') return '&gt;';
            return m;
        });
    }

    async function extract() {
        const url = urlInput.value.trim();
        if (!url) return alert('أدخل رابط MediaFire');
        if (!url.includes('mediafire.com')) return alert('الرابط غير صالح');
        resultArea.style.display = 'block';
        resultArea.innerHTML = '⏳ جاري الاستخراج... يرجى الانتظار (قد يستغرق 20-30 ثانية)';
        videoPlayer.style.display = 'none';
        videoPlayer.innerHTML = '';
        try {
            const res = await fetch('/api/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            const data = await res.json();
            if (data.success && data.directLink) {
                const link = data.directLink;
                resultArea.innerHTML = '<strong>✅ الرابط المباشر:</strong><br><a href="'+link+'" target="_blank">'+link+'</a><br>'+(data.cached ? '📦 (من الكاش)' : '✨ (تم الاستخراج)')+'<br><button id="copyBtn" style="margin-top:12px; background:#2196f3;">نسخ الرابط</button>';
                videoPlayer.style.display = 'block';
                videoPlayer.innerHTML = '<video controls autoplay style="width:100%; max-height:400px; border-radius:8px;"><source src="'+link+'" type="video/mp4">متصفحك لا يدعم تشغيل الفيديو.</video>';
                document.getElementById('copyBtn')?.addEventListener('click', () => {
                    navigator.clipboard.writeText(link);
                    alert('تم نسخ الرابط');
                });
            } else {
                resultArea.innerHTML = '<strong>❌ فشل:</strong> ' + (data.error || 'خطأ غير معروف') + '<br><br>⚠️ قد يكون MediaFire طلب تحقق بشري. حاول مرة أخرى بعد دقيقة أو استخدم رابط مختلف.';
            }
        } catch (err) {
            resultArea.innerHTML = '<strong>❌ خطأ في الطلب:</strong> ' + err.message;
        }
    }

    extractBtn.addEventListener('click', extract);
    urlInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') extract(); });
    setInterval(fetchLogs, 800);
    fetchLogs();
</script>
</body>
</html>`);
});

// ========== إيقاف نظيف ==========
async function shutdown() {
    addLog('info', 'إيقاف السيرفر...');
    if (browserInstance) await browserInstance.close().catch(() => {});
    process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.listen(PORT, '0.0.0.0', () => {
    addLog('info', `🚀 السيرفر يعمل على المنفذ ${PORT}`);
});
