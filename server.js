// =============================================
//  ULTIMATE MEDIAFIRE SERVER (PUPPETEER ONLY)
//  Dashboard متكامل | استخراج تلقائي
// =============================================

const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// ------------------- البيانات والإحصائيات -------------------
let browser = null;
let stats = {
    total: 0,
    success: 0,
    fail: 0,
    startTime: Date.now()
};
let logs = [];

// ------------------- إعداد المتصفح -------------------
async function getBrowser() {
    if (browser && browser.isConnected()) return browser;
    
    const options = {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--single-process'
        ]
    };
    
    // محاولة تحديد مسار Chromium في Termux تلقائياً
    const possiblePaths = [
        '/data/data/com.termux/files/usr/bin/chromium-browser',
        '/data/data/com.termux/files/usr/bin/chromium',
        process.env.CHROME_PATH || null
    ];
    for (const p of possiblePaths) {
        if (p && require('fs').existsSync(p)) {
            options.executablePath = p;
            console.log(`✅ باستخدام Chromium: ${p}`);
            break;
        }
    }
    
    browser = await puppeteer.launch(options);
    return browser;
}

// ------------------- استخراج الرابط -------------------
async function extractDirectLink(mediafireUrl) {
    const browserInst = await getBrowser();
    const page = await browserInst.newPage();
    const taskId = Date.now().toString(36);
    
    try {
        console.log(`[${taskId}] 🌐 فتح: ${mediafireUrl}`);
        
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1280, height: 720 });
        
        await page.goto(mediafireUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // انتظار ظهور زر التحميل
        await page.waitForSelector('#downloadButton, a.downloadButton, #download_link, a[href*="download"]', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(2000);
        
        // كشف CAPTCHA
        const content = await page.content();
        if (content.includes('recaptcha') || content.includes('verify you are human')) {
            console.log(`[${taskId}] 🤖 CAPTCHA!`);
            return { success: false, error: 'CAPTCHA_REQUIRED' };
        }
        
        // استخراج الرابط
        const result = await page.evaluate(() => {
            // زر التحميل المباشر
            const btn = document.querySelector('#downloadButton, a.downloadButton, #download_link');
            if (btn && btn.href) return btn.href;
            
            // أي رابط يحتوي على download.mediafire.com
            const links = Array.from(document.querySelectorAll('a'));
            for (let link of links) {
                if (link.href && link.href.includes('download.mediafire.com')) {
                    return link.href;
                }
            }
            
            // مصدر فيديو مدمج
            const video = document.querySelector('video');
            if (video && video.src) return video.src;
            const source = document.querySelector('source');
            if (source && source.src) return source.src;
            
            return null;
        });
        
        if (result && (result.includes('download.mediafire.com') || result.includes('.mp4'))) {
            let final = result.startsWith('//') ? 'https:' + result : result;
            console.log(`[${taskId}] ✅ نجاح: ${final.substring(0, 80)}`);
            return { success: true, directLink: final };
        }
        
        console.log(`[${taskId}] ❌ لا رابط`);
        return { success: false, error: 'NO_LINK' };
        
    } catch (err) {
        console.error(`[${taskId}] 💥 خطأ:`, err.message);
        return { success: false, error: err.message };
    } finally {
        await page.close();
    }
}

// ------------------- واجهة API -------------------
app.post('/api/extract', async (req, res) => {
    const { url } = req.body;
    stats.total++;
    
    if (!url || !url.includes('mediafire.com')) {
        stats.fail++;
        return res.status(400).json({ success: false, error: 'رابط غير صالح' });
    }
    
    const start = Date.now();
    const result = await extractDirectLink(url);
    const duration = Date.now() - start;
    
    if (result.success) {
        stats.success++;
        logs.unshift({ time: new Date(), url: url.slice(0, 60), success: true, duration, link: result.directLink });
        res.json({ success: true, directLink: result.directLink });
    } else {
        stats.fail++;
        logs.unshift({ time: new Date(), url: url.slice(0, 60), success: false, duration, error: result.error });
        res.status(500).json({ success: false, error: result.error });
    }
    
    if (logs.length > 50) logs.pop();
});

app.get('/api/stats', (req, res) => {
    const uptime = Math.floor((Date.now() - stats.startTime) / 1000);
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    const s = uptime % 60;
    res.json({
        total: stats.total,
        success: stats.success,
        fail: stats.fail,
        rate: stats.total ? ((stats.success / stats.total) * 100).toFixed(1) : 0,
        uptime: `${h}h ${m}m ${s}s`,
        logs: logs.slice(0, 20)
    });
});

// ------------------- واجهة Dashboard -------------------
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>MediaFire Ultimate Dashboard</title>
    <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{background:linear-gradient(135deg,#0f0c29,#302b63,#24243e);font-family:system-ui;padding:20px;color:#fff}
        .container{max-width:1300px;margin:auto}
        h1{text-align:center;margin-bottom:30px;background:linear-gradient(90deg,#ff8a00,#e52e71);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
        .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:20px;margin-bottom:30px}
        .card{background:rgba(255,255,255,0.1);backdrop-filter:blur(10px);border-radius:20px;padding:20px;text-align:center}
        .card-value{font-size:2.2rem;font-weight:bold;color:#ff8a00}
        .panel{background:rgba(0,0,0,0.5);border-radius:20px;padding:20px;margin-bottom:20px}
        .input-group{display:flex;gap:10px;flex-wrap:wrap}
        input{flex:1;padding:14px;border-radius:30px;border:none;background:#1e1e2f;color:#fff;font-size:1rem}
        button{padding:14px 28px;background:linear-gradient(90deg,#ff8a00,#e52e71);border:none;border-radius:30px;color:#fff;cursor:pointer;font-weight:bold}
        video{width:100%;max-height:400px;border-radius:20px;margin-top:20px;display:none}
        .logs{max-height:300px;overflow-y:auto;font-size:0.8rem}
        .log-item{padding:8px;border-bottom:1px solid rgba(255,255,255,0.1);font-family:monospace}
        .success{color:#4caf50}
        .fail{color:#f44336}
        .badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:0.7rem;margin-left:8px}
        .badge-suc{background:#4caf50}
        .badge-fail{background:#f44336}
        .status{margin:10px 0;font-size:0.9rem}
    </style>
</head>
<body>
<div class="container">
    <h1>🎬 MediaFire Ultimate Breaker</h1>
    <div class="stats" id="stats">
        <div class="card"><div class="card-value" id="total">0</div><div>الطلبات</div></div>
        <div class="card"><div class="card-value" id="success">0</div><div>ناجحة</div></div>
        <div class="card"><div class="card-value" id="fail">0</div><div>فاشلة</div></div>
        <div class="card"><div class="card-value" id="rate">0%</div><div>نسبة النجاح</div></div>
        <div class="card"><div class="card-value" id="uptime">0</div><div>وقت التشغيل</div></div>
    </div>
    
    <div class="panel">
        <div class="input-group">
            <input type="text" id="urlInput" placeholder="رابط MediaFire ..." dir="ltr">
            <button id="extractBtn">🚀 استخراج وتشغيل</button>
        </div>
        <div id="statusMsg" class="status"></div>
        <video id="videoPlayer" controls></video>
    </div>
    
    <div class="panel">
        <h3>📋 آخر العمليات</h3>
        <div id="logsList" class="logs">جاري التحميل...</div>
    </div>
</div>

<script>
    async function loadStats() {
        try {
            const res = await fetch('/api/stats');
            const data = await res.json();
            document.getElementById('total').innerText = data.total;
            document.getElementById('success').innerText = data.success;
            document.getElementById('fail').innerText = data.fail;
            document.getElementById('rate').innerText = data.rate + '%';
            document.getElementById('uptime').innerText = data.uptime;
            
            const logsDiv = document.getElementById('logsList');
            if(data.logs && data.logs.length){
                logsDiv.innerHTML = data.logs.map(log => {
                    const cls = log.success ? 'success' : 'fail';
                    const badge = log.success ? '<span class="badge badge-suc">نجاح</span>' : '<span class="badge badge-fail">فشل</span>';
                    const time = new Date(log.time).toLocaleTimeString();
                    return '<div class="log-item '+cls+'">'+badge+' '+time+' - '+log.url+'... ('+log.duration+'ms)</div>';
                }).join('');
            } else {
                logsDiv.innerHTML = 'لا توجد سجلات';
            }
        } catch(e) { console.error(e); }
    }
    
    async function extract() {
        const url = document.getElementById('urlInput').value.trim();
        if(!url || !url.includes('mediafire.com')) {
            alert('رابط MediaFire صحيح مطلوب');
            return;
        }
        const btn = document.getElementById('extractBtn');
        const statusDiv = document.getElementById('statusMsg');
        const video = document.getElementById('videoPlayer');
        
        btn.disabled = true;
        statusDiv.innerHTML = '⏳ جاري استخراج الرابط... قد يستغرق 20 ثانية';
        video.style.display = 'none';
        video.src = '';
        
        try {
            const res = await fetch('/api/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            const data = await res.json();
            if(data.success) {
                statusDiv.innerHTML = '✅ تم الاستخراج بنجاح! جاري تشغيل الفيديو...';
                video.src = data.directLink;
                video.style.display = 'block';
                video.play().catch(e => console.log);
            } else {
                statusDiv.innerHTML = '❌ فشل: ' + (data.error === 'CAPTCHA_REQUIRED' ? 'يطلب CAPTCHA، لا يمكن الاستخراج تلقائياً' : data.error);
            }
        } catch(err) {
            statusDiv.innerHTML = '❌ خطأ في الاتصال بالسيرفر';
        } finally {
            btn.disabled = false;
            loadStats();
        }
    }
    
    document.getElementById('extractBtn').addEventListener('click', extract);
    document.getElementById('urlInput').addEventListener('keypress', e => { if(e.key === 'Enter') extract(); });
    loadStats();
    setInterval(loadStats, 3000);
</script>
</body>
</html>
    `);
});

// ------------------- التشغيل -------------------
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n=================================`);
    console.log(`🚀 Ultimate MediaFire Server`);
    console.log(`📡 Dashboard: http://localhost:${PORT}`);
    console.log(`🖥️  API: POST /api/extract`);
    console.log(`⚙️  تجهيز المتصفح...`);
    await getBrowser();
    console.log(`✅ جاهز للعمل!\n=================================`);
});