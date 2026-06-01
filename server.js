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

const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
];

const acceptLanguages = [
    'en-US,en;q=0.9,ar;q=0.8',
    'ar-SA,ar;q=0.9,en;q=0.8',
];

const referrers = [
    'https://www.google.com/',
    'https://www.facebook.com/',
];

const secChUa = [
    '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
];

function generateFingerprint() {
    return {
        sessionId: crypto.randomBytes(32).toString('hex'),
        deviceId: crypto.randomBytes(16).toString('hex'),
        timestamp: Date.now(),
        random: Math.random().toString(36).substring(2, 15)
    };
}

function getFreshHeaders() {
    const fp = generateFingerprint();
    
    return {
        'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': acceptLanguages[Math.floor(Math.random() * acceptLanguages.length)],
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Sec-Ch-Ua': secChUa[Math.floor(Math.random() * secChUa.length)],
        'Sec-Ch-Ua-Mobile': '?0',
        'Referer': referrers[Math.floor(Math.random() * referrers.length)],
        'Cache-Control': 'no-cache',
    };
}

function randomDelay(min = 300, max = 1200) {
    return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
}

function isCaptchaPage(html) {
    return html.includes('recaptcha') || 
           html.includes('verify you are human') ||
           html.includes('Help us verify you are human') ||
           html.includes('g-recaptcha-response') ||
           html.includes('I\'m not a robot');
}

function isVideoLink(link) {
    if (!link) return false;
    return link.includes('download.mediafire.com') || 
           link.includes('.mp4') ||
           link.includes('.m3u8') ||
           link.includes('.mkv') ||
           link.includes('.webm') ||
           link.match(/\.(mp4|m3u8|mkv|webm)(\?|$)/i) !== null;
}

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

function extractFromScripts(html) {
    const patterns = [
        /"download_link"\s*:\s*"([^"]+)"/i,
        /downloadUrl\s*:\s*['"]([^'"]+)['"]/i,
        /https:\/\/download\d+\.mediafire\.com\/[a-z0-9]+\/[a-z0-9]+\/[^'"\s]+/i
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

function normalizeLink(link) {
    if (link.startsWith('//')) link = 'https:' + link;
    if (link.startsWith('/')) link = 'https://www.mediafire.com' + link;
    return link.split('?')[0].replace(/&amp;/g, '&');
}

async function extractDirectLink(mediafireUrl) {
    console.log(`\n🔍 بدء استخراج الرابط: ${mediafireUrl}`);
    
    for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`\n📡 محاولة ${attempt}/3...`);
        
        const headers = getFreshHeaders();
        
        if (attempt > 1) {
            const delay = randomDelay(2000, 5000);
            console.log(`   ⏳ انتظار ${Math.round(delay/1000)} ثانية...`);
            await delay;
        }
        
        try {
            const { data: html } = await axios.get(mediafireUrl, {
                headers: headers,
                timeout: 20000,
                maxRedirects: 5,
            });
            
            if (isCaptchaPage(html)) {
                console.log(`   🤖 CAPTCHA detected - IP is blocked`);
                return { 
                    success: false, 
                    error: 'IP_BLOCKED',
                    needsCaptcha: true
                };
            }
            
            let directLink = extractLinkFromHtml(html);
            if (!directLink) {
                directLink = extractFromScripts(html);
            }
            
            if (directLink && isVideoLink(directLink)) {
                console.log(`   ✅ رابط فيديو حقيقي: ${directLink}`);
                return { success: true, directLink: directLink };
            } else if (directLink) {
                console.log(`   ⚠️ رابط مستخرج لكنه ليس فيديو: ${directLink.substring(0, 100)}`);
                return { 
                    success: false, 
                    error: 'INVALID_LINK',
                    message: 'الرابط المستخرج ليس فيديو'
                };
            }
            
            console.log(`   ⚠️ لم يتم العثور على رابط في المحاولة ${attempt}`);
            
        } catch (error) {
            console.log(`   ❌ خطأ في المحاولة ${attempt}: ${error.message}`);
        }
    }
    
    return { success: false, error: 'فشل الاستخراج بعد 3 محاولات' };
}

// ============= API =============

app.post('/api/extract', async (req, res) => {
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
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/extract', async (req, res) => {
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
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString()
    });
});

// ============= صفحة HTML لعرض الفيديو =============

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MediaFire Video Player - مشاهدة الفيديو</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: #0a0a0a;
            min-height: 100vh;
            color: #fff;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
        }
        
        .header {
            text-align: center;
            padding: 30px 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            border-radius: 20px;
            margin-bottom: 30px;
        }
        
        .header h1 {
            font-size: 28px;
            margin-bottom: 10px;
        }
        
        .header p {
            opacity: 0.9;
            font-size: 14px;
        }
        
        .video-container {
            background: #000;
            border-radius: 20px;
            overflow: hidden;
            margin-bottom: 30px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        }
        
        video {
            width: 100%;
            max-height: 70vh;
            background: #000;
        }
        
        .info-box {
            background: #1a1a2e;
            border-radius: 15px;
            padding: 20px;
            margin-bottom: 20px;
        }
        
        .info-box h3 {
            margin-bottom: 15px;
            color: #667eea;
        }
        
        .link-box {
            background: #0f0f1a;
            padding: 15px;
            border-radius: 10px;
            word-break: break-all;
            font-size: 12px;
            color: #888;
            margin-top: 10px;
        }
        
        .link-box a {
            color: #667eea;
            text-decoration: none;
        }
        
        .link-box a:hover {
            text-decoration: underline;
        }
        
        .input-section {
            background: #1a1a2e;
            border-radius: 15px;
            padding: 25px;
        }
        
        .input-group {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        
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
        
        input:focus {
            outline: none;
            border-color: #667eea;
        }
        
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
        
        button:hover {
            transform: translateY(-2px);
        }
        
        .status {
            margin-top: 20px;
            padding: 15px;
            border-radius: 10px;
            display: none;
        }
        
        .status.show {
            display: block;
        }
        
        .status.success {
            background: #1a3a1a;
            border: 1px solid #2a5a2a;
            color: #4ecdc4;
        }
        
        .status.error {
            background: #3a1a1a;
            border: 1px solid #5a2a2a;
            color: #ff6b6b;
        }
        
        .status.info {
            background: #1a2a3a;
            border: 1px solid #2a4a5a;
            color: #ffd93d;
        }
        
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
        
        .button-text {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
        }
        
        .quality-badge {
            position: absolute;
            bottom: 10px;
            right: 10px;
            background: rgba(0,0,0,0.7);
            padding: 4px 8px;
            border-radius: 5px;
            font-size: 11px;
        }
        
        .video-wrapper {
            position: relative;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎬 MediaFire Video Player</h1>
            <p>أدخل رابط MediaFire لمشاهدة الفيديو مباشرة</p>
        </div>
        
        <div class="video-container" id="videoContainer" style="display: none;">
            <div class="video-wrapper">
                <video id="videoPlayer" controls playsinline>
                    متصفحك لا يدعم تشغيل الفيديو
                </video>
            </div>
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
        </div>
        
        <div id="infoBox" class="info-box" style="display: none;">
            <h3>📋 معلومات الرابط</h3>
            <div id="linkInfo" class="link-box"></div>
        </div>
    </div>
    
    <script>
        const urlInput = document.getElementById('urlInput');
        const extractBtn = document.getElementById('extractBtn');
        const videoContainer = document.getElementById('videoContainer');
        const videoPlayer = document.getElementById('videoPlayer');
        const statusDiv = document.getElementById('status');
        const infoBox = document.getElementById('infoBox');
        const linkInfo = document.getElementById('linkInfo');
        
        let currentVideoUrl = null;
        
        function showStatus(message, type) {
            statusDiv.innerHTML = message;
            statusDiv.className = \`status \${type} show\`;
            
            // اخفاء بعد 5 ثواني للنجاح
            if (type === 'success') {
                setTimeout(() => {
                    statusDiv.classList.remove('show');
                }, 5000);
            }
        }
        
        function showVideo(videoUrl) {
            console.log('🎬 تشغيل الفيديو:', videoUrl);
            
            // تنظيف الرابط
            let cleanUrl = videoUrl;
            if (cleanUrl.startsWith('//')) cleanUrl = 'https:' + cleanUrl;
            
            currentVideoUrl = cleanUrl;
            
            // تعيين مصدر الفيديو
            videoPlayer.src = cleanUrl;
            videoPlayer.load();
            
            // عرض حاوية الفيديو
            videoContainer.style.display = 'block';
            
            // محاولة التشغيل التلقائي
            const playPromise = videoPlayer.play();
            if (playPromise !== undefined) {
                playPromise.catch(error => {
                    console.log('التشغيل التلقائي تم منعه:', error);
                    showStatus('⚠️ اضغط على زر التشغيل لمشاهدة الفيديو', 'info');
                });
            }
            
            // عرض معلومات الرابط
            infoBox.style.display = 'block';
            linkInfo.innerHTML = \`
                <strong>رابط التشغيل المباشر:</strong><br>
                <a href="\${cleanUrl}" target="_blank">\${cleanUrl.substring(0, 80)}...</a><br><br>
                <strong>نوع الفيديو:</strong> \${cleanUrl.includes('.mp4') ? 'MP4' : cleanUrl.includes('.m3u8') ? 'M3U8' : 'غير معروف'}<br>
                <strong>الحالة:</strong> جاهز للتشغيل
            \`;
        }
        
        function handleCaptcha(originalUrl) {
            showStatus(\`
                🔒 <strong>يطلب الموقع تأكيد أنك إنسان (CAPTCHA)</strong><br><br>
                📌 جاري فتح الرابط في نافذة جديدة...<br>
                بعد إكمال التحقق، ارجع إلى هنا واضغط "إعادة المحاولة"
            \`, 'info');
            
            // فتح الرابط في نافذة جديدة
            setTimeout(() => {
                window.open(originalUrl, '_blank');
            }, 1000);
            
            // تغيير الزر لإعادة المحاولة
            extractBtn.innerHTML = '<span class="button-text"><span>🔄 إعادة المحاولة</span></span>';
            extractBtn.onclick = () => {
                extractBtn.onclick = originalOnClick;
                extractBtn.innerHTML = '<span class="button-text"><span>▶️ تشغيل الفيديو</span></span>';
                extract();
            };
        }
        
        async function extract() {
            const url = urlInput.value.trim();
            
            if (!url) {
                showStatus('❌ الرجاء إدخال رابط MediaFire', 'error');
                return;
            }
            
            if (!url.includes('mediafire.com')) {
                showStatus('❌ الرابط يجب أن يكون من موقع MediaFire', 'error');
                return;
            }
            
            // إخفاء الفيديو القديم
            videoContainer.style.display = 'none';
            infoBox.style.display = 'none';
            videoPlayer.src = '';
            
            // إظهار حالة التحميل
            extractBtn.disabled = true;
            extractBtn.innerHTML = '<span class="button-text"><div class="loading"></div><span>جاري الاستخراج...</span></span>';
            showStatus('⏳ جاري استخراج رابط الفيديو... قد يستغرق 5-10 ثواني', 'info');
            
            try {
                const response = await fetch('/api/extract', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ url: url })
                });
                
                const data = await response.json();
                console.log('📦 response:', data);
                
                if (data.success && data.directLink) {
                    // التحقق من أن الرابط فيديو قابل للتشغيل
                    const videoUrl = data.directLink;
                    const isPlayable = videoUrl.includes('.mp4') || 
                                      videoUrl.includes('.m3u8') || 
                                      videoUrl.includes('download.mediafire.com');
                    
                    if (isPlayable) {
                        showStatus('✅ تم استخراج الرابط بنجاح! جاري تحميل الفيديو...', 'success');
                        showVideo(videoUrl);
                    } else {
                        showStatus('⚠️ الرابط المستخرج ليس فيديو قابل للتشغيل المباشر', 'error');
                        handleCaptcha(url);
                    }
                    
                } else if (data.error === 'IP_BLOCKED' || data.needsCaptcha) {
                    handleCaptcha(url);
                    
                } else {
                    showStatus(\`❌ فشل الاستخراج: \${data.error || 'خطأ غير معروف'}\`, 'error');
                }
                
            } catch (error) {
                console.error('Error:', error);
                showStatus(\`❌ خطأ في الاتصال بالسيرفر: \${error.message}\`, 'error');
            } finally {
                extractBtn.disabled = false;
                if (extractBtn.innerHTML.includes('جاري')) {
                    extractBtn.innerHTML = '<span class="button-text"><span>▶️ تشغيل الفيديو</span></span>';
                }
            }
        }
        
        const originalOnClick = extract;
        
        // استخراج عند الضغط على Enter
        urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                extract();
            }
        });
        
        extractBtn.addEventListener('click', extract);
        
        // التعامل مع أخطاء الفيديو
        videoPlayer.addEventListener('error', (e) => {
            console.error('Video error:', e);
            showStatus('❌ تعذر تشغيل الفيديو. قد يكون الرابط غير صالح أو يحتاج إلى تحميل', 'error');
        });
        
        console.log('✅ الصفحة جاهزة');
    </script>
</body>
</html>
    `);
});

// ============= تشغيل السيرفر =============

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 السيرفر يعمل على http://localhost:${PORT}`);
    console.log(`🔐 كشف CAPTCHA: مفعل`);
    console.log(`🎬 صفحة المشاهدة: http://localhost:${PORT}`);
});
