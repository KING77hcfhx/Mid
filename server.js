require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 8080;

app.set('trust proxy', 1);

const limiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    trustProxy: true,
    keyGenerator: (req) => req.ip || req.connection.remoteAddress,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// === كاش النتائج ===
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000;
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of cache.entries()) {
        if (now - v.timestamp > CACHE_TTL) cache.delete(k);
    }
}, 5 * 60 * 1000);

// === سجل الأحداث (للواجهة) ===
let eventLogs = [];
const MAX_LOGS = 100;
function addLog(level, message, meta = {}) {
    const entry = { timestamp: new Date().toISOString(), level, message, ...meta };
    eventLogs.unshift(entry);
    if (eventLogs.length > MAX_LOGS) eventLogs.pop();
    console.log(`[${level}] ${message}`);
}

// === مدير المتصفح مع إعادة التشغيل التلقائي ===
let browserPromise = null;

async function getBrowser() {
    if (browserPromise) {
        try {
            const b = await browserPromise;
            if (b && b.isConnected()) return b;
        } catch (e) {
            addLog('warn', `بrowser غير صالح: ${e.message}`);
        }
    }
    addLog('info', '🔄 تشغيل Chromium جديد...');
    browserPromise = chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-accelerated-2d-canvas',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding'
        ]
    });
    const browser = await browserPromise;
    addLog('info', '✅ Chromium جاهز');
    return browser;
}

async function resetBrowser() {
    addLog('warn', '🔄 إعادة تعيين المتصفح بسبب خطأ');
    if (browserPromise) {
        try {
            const old = await browserPromise;
            await old.close().catch(() => {});
        } catch {}
    }
    browserPromise = null;
    return getBrowser();
}

// === استخراج الرابط مع محاولات متعددة وإعادة إنشاء المتصفح ===
async function extractDirectLink(url, retry = 0) {
    const start = Date.now();
    addLog('info', `🌐 استخراج: ${url} (محاولة ${retry+1})`);
    let browser = null;
    let context = null;
    let page = null;
    try {
        browser = await getBrowser();
        context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 720 },
            locale: 'en-US'
        });
        page = await context.newPage();
        
        // استخدام domcontentloaded أسرع من networkidle
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
        
        // انتظار عنصر التحميل لمدة قصيرة
        await page.waitForSelector('a#downloadButton, a.downloadButton, a#download_link', { timeout: 8000 }).catch(() => {});
        
        let directLink = await page.evaluate(() => {
            const btn = document.querySelector('a#downloadButton, a.downloadButton, a#download_link');
            if (btn && btn.href) return btn.href;
            const scripts = Array.from(document.querySelectorAll('script'));
            for (let s of scripts) {
                const match = s.innerHTML.match(/"(https:\/\/download\d+\.mediafire\.com\/[^"]+)"/);
                if (match) return match[1];
            }
            return null;
        });
        
        if (!directLink && page.url().includes('download')) directLink = page.url();
        
        if (directLink) {
            addLog('success', `✅ تم الاستخراج (${Date.now()-start}ms): ${directLink.substring(0,80)}...`);
            return { success: true, directLink, timestamp: Date.now() };
        } else {
            throw new Error('لم يتم العثور على رابط تحميل');
        }
    } catch (err) {
        const errorMsg = err.message;
        addLog('error', `❌ فشل: ${errorMsg}`);
        
        // إذا كان الخطأ بسبب إغلاق المتصفح، نعيد تعيينه ونعيد المحاولة
        if (errorMsg.includes('Target page') || errorMsg.includes('closed') || errorMsg.includes('browser')) {
            addLog('warn', 'المتصفح مغلق – سيتم إعادة تشغيله');
            await resetBrowser();
            if (retry < 3) {
                await new Promise(r => setTimeout(r, 1500));
                return extractDirectLink(url, retry + 1);
            }
        } else if (retry < 2) {
            await new Promise(r => setTimeout(r, 2000));
            return extractDirectLink(url, retry + 1);
        }
        return { success: false, error: errorMsg };
    } finally {
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
        // نترك المتصفح مفتوحاً للطلبات التالية
    }
}

// === API endpoints ===
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

// === صفحة HTML (نفس السابقة + محسنة) ===
app.get('/', (req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MediaFire Link Extractor</title>
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
        hr { border-color: #3a3a4a; }
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
        resultArea.innerHTML = '⏳ جاري الاستخراج... يرجى الانتظار';
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
                resultArea.innerHTML = '<strong>❌ فشل:</strong> ' + (data.error || 'خطأ غير معروف');
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

// تنظيف الخروج
async function shutdown() {
    addLog('info', 'إيقاف السيرفر...');
    if (browserPromise) {
        try {
            const b = await browserPromise;
            await b.close();
        } catch {}
    }
    process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

app.listen(PORT, '0.0.0.0', () => {
    addLog('info', `🚀 السيرفر يعمل على المنفذ ${PORT}`);
});
