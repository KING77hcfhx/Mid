const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// قائمة كبيرة من وكلاء المستخدمين (User Agents)
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/122.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
];

// قائمة لغات
const acceptLanguages = [
    'en-US,en;q=0.9,ar;q=0.8',
    'ar-SA,ar;q=0.9,en;q=0.8',
    'en-US,en;q=0.9',
    'ar,en;q=0.9',
    'fr-FR,fr;q=0.9,en;q=0.8',
];

// قائمة مراجع (Referrers)
const referrers = [
    'https://www.google.com/',
    'https://www.facebook.com/',
    'https://twitter.com/',
    'https://www.youtube.com/',
    'https://www.reddit.com/',
    'https://www.mediafire.com/',
    'https://www.bing.com/',
    'https://www.yahoo.com/',
];

// قائمة Sec-Ch-Ua
const secChUa = [
    '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
    '"Chromium";v="120", "Not(A:Brand";v="24", "Google Chrome";v="120"',
    '"Microsoft Edge";v="121", "Not(A:Brand";v="24", "Chromium";v="121"',
];

// قائمة عناوين IP وهمية (للتمويه فقط)
const clientIps = [
    '192.168.1.1', '10.0.0.1', '172.16.0.1', '192.168.0.1', '10.0.0.2'
];

// توليد بصمة فريدة لكل طلب
function generateFingerprint() {
    return {
        sessionId: crypto.randomBytes(32).toString('hex'),
        deviceId: crypto.randomBytes(16).toString('hex'),
        timestamp: Date.now(),
        random: Math.random().toString(36).substring(2, 15),
        nonce: crypto.randomBytes(8).toString('hex')
    };
}

// توليد كوكيز فريدة لكل طلب
function generateFreshCookies() {
    const fp = generateFingerprint();
    return [
        `__cf_bm=${fp.sessionId}`,
        `_ga=GA1.2.${Math.floor(Math.random() * 9999999)}.${fp.timestamp}`,
        `_gid=GA1.2.${Math.floor(Math.random() * 9999999)}.${fp.timestamp}`,
        `device_id=${fp.deviceId}`,
        `session=${fp.random}`,
        `nonce=${fp.nonce}`,
        `visitor_id=${crypto.randomBytes(8).toString('hex')}`
    ].join('; ');
}

// رؤوس جديدة بالكامل لكل طلب
function getFreshHeaders() {
    const fp = generateFingerprint();
    
    return {
        'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': acceptLanguages[Math.floor(Math.random() * acceptLanguages.length)],
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Sec-Ch-Ua': secChUa[Math.floor(Math.random() * secChUa.length)],
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': Math.random() > 0.5 ? '"Windows"' : '"macOS"',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'DNT': '1',
        'Referer': referrers[Math.floor(Math.random() * referrers.length)],
        'Cookie': generateFreshCookies(),
        'X-Forwarded-For': clientIps[Math.floor(Math.random() * clientIps.length)],
        'X-Requested-With': 'XMLHttpRequest'
    };
}

// تأخير عشوائي بين الطلبات
function randomDelay(min = 1000, max = 4000) {
    return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
}

// التحقق من وجود CAPTCHA
function isCaptchaPage(html) {
    return html.includes('recaptcha') || 
           html.includes('verify you are human') ||
           html.includes('Help us verify you are human') ||
           html.includes('g-recaptcha-response') ||
           html.includes('I\'m not a robot') ||
           html.includes('cf-challenge');
}

// التحقق من أن الرابط فيديو
function isVideoLink(link) {
    if (!link) return false;
    return link.includes('download.mediafire.com') || 
           link.includes('.mp4') ||
           link.includes('.m3u8') ||
           link.includes('.mkv') ||
           link.includes('.webm') ||
           link.match(/\.(mp4|m3u8|mkv|webm|mov)(\?|$)/i) !== null;
}

// استخراج الرابط من HTML
function extractLinkFromHtml(html) {
    const $ = cheerio.load(html);
    
    const selectors = [
        '#downloadButton',
        'a.downloadButton',
        'a#download_link',
        'a[aria-label="Download file"]',
        'div.download_link a',
        'a.btn-primary',
        'a[href*="download"]',
        '.download-link a',
        '#download_link',
        '.download_button'
    ];
    
    for (const selector of selectors) {
        const href = $(selector).attr('href');
        if (href && (href.includes('download.mediafire.com') || href.includes('.mp4'))) {
            return normalizeLink(href);
        }
    }
    
    let found = null;
    $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && (href.includes('download.mediafire.com') || href.includes('.mp4'))) {
            found = href;
            return false;
        }
    });
    
    return found ? normalizeLink(found) : null;
}

// استخراج من النصوص البرمجية
function extractFromScripts(html) {
    const patterns = [
        /"download_link"\s*:\s*"([^"]+)"/i,
        /downloadUrl\s*:\s*['"]([^'"]+)['"]/i,
        /https:\/\/download\d+\.mediafire\.com\/[a-z0-9]+\/[a-z0-9]+\/[^'"\s]+/i,
        /https:\/\/[^"]+\.mediafire\.com\/[^"]+\.mp4/i,
        /href="(https:\/\/download[^"]+)"/i
    ];
    
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
            const link = match[1];
            if (link.includes('download.mediafire.com') || link.includes('.mp4')) {
                return normalizeLink(link);
            }
        }
    }
    return null;
}

// تطبيع الرابط
function normalizeLink(link) {
    if (link.startsWith('//')) link = 'https:' + link;
    if (link.startsWith('/')) link = 'https://www.mediafire.com' + link;
    return link.split('?')[0].replace(/&amp;/g, '&');
}

// استخراج الرابط مع تجديد كامل للهوية
async function extractDirectLink(mediafireUrl) {
    console.log(`\n🔍 بدء استخراج الرابط: ${mediafireUrl}`);
    console.log(`🕐 الوقت: ${new Date().toISOString()}`);
    
    // قائمة المحاولات
    for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`\n📡 محاولة ${attempt}/3 - تجديد الهوية بالكامل...`);
        
        // رؤوس جديدة لكل محاولة
        const headers = getFreshHeaders();
        console.log(`   👤 User-Agent: ${headers['User-Agent'].substring(0, 50)}...`);
        console.log(`   🍪 Session: ${headers['Cookie'].substring(0, 50)}...`);
        
        // تأخير عشوائي بين المحاولات
        if (attempt > 1) {
            const delay = randomDelay(2000, 6000);
            console.log(`   ⏳ انتظار ${Math.round(delay/1000)} ثواني...`);
            await delay;
        }
        
        try {
            const { data: html } = await axios.get(mediafireUrl, {
                headers: headers,
                timeout: 25000,
                maxRedirects: 5,
                withCredentials: true,
                params: { 
                    _t: Date.now(), 
                    _r: Math.random(),
                    _session: crypto.randomBytes(4).toString('hex')
                }
            });
            
            // التحقق من CAPTCHA
            if (isCaptchaPage(html)) {
                console.log(`   🤖 تم اكتشاف CAPTCHA في المحاولة ${attempt}`);
                // نستمر للمحاولة التالية بهوية جديدة
                continue;
            }
            
            let directLink = extractLinkFromHtml(html);
            if (!directLink) {
                directLink = extractFromScripts(html);
            }
            
            if (directLink && isVideoLink(directLink)) {
                console.log(`   ✅ نجحت المحاولة ${attempt}!`);
                console.log(`   📹 الرابط: ${directLink}`);
                return { success: true, directLink: directLink };
            }
            
            console.log(`   ⚠️ لم يتم العثور على رابط في المحاولة ${attempt}`);
            
        } catch (error) {
            console.log(`   ❌ خطأ في المحاولة ${attempt}: ${error.message}`);
            if (error.response) {
                console.log(`   📊 حالة الاستجابة: ${error.response.status}`);
            }
        }
    }
    
    console.log(`\n❌ فشلت جميع المحاولات - يطلب الموقع CAPTCHA`);
    return { 
        success: false, 
        error: 'IP_BLOCKED',
        needsCaptcha: true,
        message: 'يتطلب الموقع تأكيد أنك إنسان'
    };
}

// ============= API =============

app.post('/api/extract', async (req, res) => {
    console.log(`\n📨 طلب جديد: ${req.method} ${req.url}`);
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ success: false, error: 'يرجى إرسال رابط MediaFire' });
        }
        
        if (!url.includes('mediafire.com')) {
            return res.status(400).json({ success: false, error: 'الرابط يجب أن يكون من موقع MediaFire' });
        }
        
        const result = await extractDirectLink(url);
        res.json(result);
        
    } catch (error) {
        console.error(`💥 خطأ عام: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/extract', async (req, res) => {
    console.log(`\n📨 طلب جديد: ${req.method} ${req.url}`);
    try {
        const { url } = req.query;
        
        if (!url) {
            return res.status(400).json({ success: false, error: 'يرجى إضافة رابط MediaFire' });
        }
        
        if (!url.includes('mediafire.com')) {
            return res.status(400).json({ success: false, error: 'الرابط يجب أن يكون من موقع MediaFire' });
        }
        
        const result = await extractDirectLink(url);
        res.json(result);
        
    } catch (error) {
        console.error(`💥 خطأ عام: ${error.message}`);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        message: 'كل طلب بهوية جديدة تماماً'
    });
});

// ============= صفحة HTML =============

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MediaFire Video Player</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
            min-height: 100vh;
            color: #fff;
        }
        .container { max-width: 1000px; margin: 0 auto; padding: 20px; }
        .header {
            text-align: center;
            padding: 30px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 20px;
            margin-bottom: 30px;
        }
        .header h1 { font-size: 28px; margin-bottom: 10px; }
        .header p { opacity: 0.9; font-size: 14px; }
        .video-container {
            background: #000;
            border-radius: 20px;
            overflow: hidden;
            margin-bottom: 20px;
            display: none;
        }
        video { width: 100%; max-height: 60vh; background: #000; }
        .input-section {
            background: #1a1a2e;
            border-radius: 15px;
            padding: 25px;
        }
        .input-group { display: flex; gap: 10px; flex-wrap: wrap; }
        input {
            flex: 1;
            padding: 15px 20px;
            border: 2px solid #333;
            border-radius: 12px;
            background: #0f0f1a;
            color: #fff;
            font-size: 14px;
            direction: ltr;
        }
        input:focus { outline: none; border-color: #667eea; }
        button {
            padding: 15px 30px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 12px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
            transition: transform 0.2s;
        }
        button:hover { transform: translateY(-2px); }
        .status {
            margin-top: 20px;
            padding: 15px;
            border-radius: 10px;
            display: none;
        }
        .status.show { display: block; }
        .status.success { background: #1a3a1a; border: 1px solid #2a5a2a; color: #4ecdc4; }
        .status.error { background: #3a1a1a; border: 1px solid #5a2a2a; color: #ff6b6b; }
        .status.info { background: #1a2a3a; border: 1px solid #2a4a5a; color: #ffd93d; }
        .loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin-left: 10px;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .button-text { display: flex; align-items: center; justify-content: center; gap: 10px; }
        .attempts { font-size: 11px; color: #888; margin-top: 15px; text-align: center; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎬 MediaFire Video Player</h1>
            <p>أدخل رابط MediaFire - كل محاولة بهوية جديدة</p>
        </div>
        
        <div class="video-container" id="videoContainer">
            <video id="videoPlayer" controls playsinline>متصفحك لا يدعم تشغيل الفيديو</video>
        </div>
        
        <div id="status" class="status"></div>
        
        <div class="input-section">
            <div class="input-group">
                <input type="text" id="urlInput" placeholder="https://www.mediafire.com/file/..." dir="ltr">
                <button id="extractBtn">
                    <span class="button-text">
                        <span>▶️ تشغيل الفيديو</span>
                    </span>
                </button>
            </div>
            <div class="attempts" id="attemptInfo"></div>
        </div>
    </div>
    
    <script>
        const urlInput = document.getElementById('urlInput');
        const extractBtn = document.getElementById('extractBtn');
        const videoContainer = document.getElementById('videoContainer');
        const videoPlayer = document.getElementById('videoPlayer');
        const statusDiv = document.getElementById('status');
        const attemptInfo = document.getElementById('attemptInfo');
        
        let attemptCount = 0;
        
        function showStatus(message, type) {
            statusDiv.innerHTML = message;
            statusDiv.className = \`status \${type} show\`;
            if (type === 'success') {
                setTimeout(() => statusDiv.classList.remove('show'), 8000);
            }
        }
        
        async function extract() {
            const url = urlInput.value.trim();
            if (!url) { showStatus('❌ الرجاء إدخال رابط MediaFire', 'error'); return; }
            if (!url.includes('mediafire.com')) { showStatus('❌ الرابط يجب أن يكون من موقع MediaFire', 'error'); return; }
            
            attemptCount++;
            attemptInfo.innerHTML = \`🔄 محاولة رقم \${attemptCount} - كل محاولة بهوية جديدة\`;
            
            videoContainer.style.display = 'none';
            videoPlayer.src = '';
            
            extractBtn.disabled = true;
            extractBtn.innerHTML = '<span class="button-text"><div class="loading"></div><span>جاري الاستخراج...</span></span>';
            showStatus('⏳ جاري استخراج الرابط بهوية جديدة... (قد يستغرق 10-15 ثانية)', 'info');
            
            try {
                const response = await fetch('/api/extract', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: url })
                });
                const data = await response.json();
                console.log('Response:', data);
                
                if (data.success && data.directLink) {
                    const videoUrl = data.directLink;
                    showStatus('✅ تم استخراج الرابط بنجاح! جاري التشغيل...', 'success');
                    videoContainer.style.display = 'block';
                    videoPlayer.src = videoUrl;
                    videoPlayer.load();
                    videoPlayer.play().catch(e => console.log('Auto-play:', e));
                } else if (data.error === 'IP_BLOCKED' || data.needsCaptcha) {
                    showStatus('⚠️ ' + (data.message || 'يتطلب الموقع تأكيد أنك إنسان. سيتم فتح الرابط في نافذة جديدة.'), 'info');
                    setTimeout(() => { window.open(url, '_blank'); }, 1500);
                } else {
                    showStatus(\`❌ فشل: \${data.error || 'خطأ غير معروف'}\`, 'error');
                }
            } catch (error) {
                showStatus(\`❌ خطأ: \${error.message}\`, 'error');
            } finally {
                extractBtn.disabled = false;
                extractBtn.innerHTML = '<span class="button-text"><span>▶️ تشغيل الفيديو</span></span>';
            }
        }
        
        urlInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') extract(); });
        extractBtn.addEventListener('click', extract);
        console.log('✅ الصفحة جاهزة - كل طلب بهوية جديدة');
    </script>
</body>
</html>
    `);
});

// ============= تشغيل السيرفر =============

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 السيرفر يعمل على http://localhost:${PORT}`);
    console.log(`🔐 وضع التمويه: مفعل 100%`);
    console.log(`🍪 كل طلب = هوية جديدة + كوكيز جديدة + بصمة جديدة`);
    console.log(`📱 صفحة الاختبار: http://localhost:${PORT}`);
});
