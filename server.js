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

// ============= دوال الكشف =============

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

// ============= صفحة اختبار HTML =============

app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MediaFire Extractor - اختبار</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            padding: 20px;
        }
        
        .container {
            max-width: 900px;
            margin: 0 auto;
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            overflow: hidden;
        }
        
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        
        .header h1 {
            font-size: 28px;
            margin-bottom: 10px;
        }
        
        .header p {
            opacity: 0.9;
            font-size: 14px;
        }
        
        .content {
            padding: 30px;
        }
        
        .input-group {
            margin-bottom: 20px;
        }
        
        label {
            display: block;
            margin-bottom: 8px;
            font-weight: bold;
            color: #333;
        }
        
        input {
            width: 100%;
            padding: 12px 15px;
            border: 2px solid #e0e0e0;
            border-radius: 10px;
            font-size: 14px;
            direction: ltr;
            transition: border-color 0.3s;
        }
        
        input:focus {
            outline: none;
            border-color: #667eea;
        }
        
        button {
            width: 100%;
            padding: 12px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: bold;
            cursor: pointer;
            transition: transform 0.2s;
        }
        
        button:hover {
            transform: translateY(-2px);
        }
        
        button:active {
            transform: translateY(0);
        }
        
        .result {
            margin-top: 30px;
            padding: 20px;
            border-radius: 10px;
            display: none;
        }
        
        .result.show {
            display: block;
        }
        
        .result.success {
            background: #d4edda;
            border: 1px solid #c3e6cb;
            color: #155724;
        }
        
        .result.error {
            background: #f8d7da;
            border: 1px solid #f5c6cb;
            color: #721c24;
        }
        
        .result.info {
            background: #d1ecf1;
            border: 1px solid #bee5eb;
            color: #0c5460;
        }
        
        .link {
            word-break: break-all;
            color: #007bff;
            text-decoration: none;
        }
        
        .link:hover {
            text-decoration: underline;
        }
        
        video {
            width: 100%;
            margin-top: 20px;
            border-radius: 10px;
            display: none;
        }
        
        video.show {
            display: block;
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
        
        .footer {
            background: #f8f9fa;
            padding: 15px;
            text-align: center;
            font-size: 12px;
            color: #666;
            border-top: 1px solid #e0e0e0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🎬 MediaFire Video Extractor</h1>
            <p>أدخل رابط MediaFire لاستخراج رابط الفيديو المباشر</p>
        </div>
        
        <div class="content">
            <div class="input-group">
                <label>رابط MediaFire:</label>
                <input type="text" id="urlInput" placeholder="https://www.mediafire.com/file/..." dir="ltr">
            </div>
            
            <button id="extractBtn">
                <span class="button-text">
                    <span>🔍 استخراج الرابط</span>
                </span>
            </button>
            
            <div id="result" class="result"></div>
            <video id="videoPlayer" controls></video>
        </div>
        
        <div class="footer">
            <p>⚠️ ملاحظة: إذا ظهرت رسالة CAPTCHA، سيتم فتح الرابط في نافذة جديدة للتحقق</p>
        </div>
    </div>
    
    <script>
        const urlInput = document.getElementById('urlInput');
        const extractBtn = document.getElementById('extractBtn');
        const resultDiv = document.getElementById('result');
        const videoPlayer = document.getElementById('videoPlayer');
        
        async function extract() {
            const url = urlInput.value.trim();
            
            if (!url) {
                showResult('الرجاء إدخال رابط MediaFire', 'error');
                return;
            }
            
            if (!url.includes('mediafire.com')) {
                showResult('الرابط يجب أن يكون من موقع MediaFire', 'error');
                return;
            }
            
            // إظهار حالة التحميل
            extractBtn.disabled = true;
            extractBtn.querySelector('.button-text').innerHTML = '<div class="loading"></div><span>جاري الاستخراج...</span>';
            resultDiv.className = 'result';
            resultDiv.style.display = 'none';
            videoPlayer.style.display = 'none';
            
            try {
                const response = await fetch('/api/extract', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ url: url })
                });
                
                const data = await response.json();
                
                if (data.success && data.directLink) {
                    // نجح الاستخراج
                    showResult(\`✅ <strong>تم استخراج الرابط بنجاح!</strong><br><br>
                    📹 رابط الفيديو:<br>
                    <a href="\${data.directLink}" target="_blank" class="link">\${data.directLink}</a>\`, 'success');
                    
                    // تشغيل الفيديو
                    videoPlayer.src = data.directLink;
                    videoPlayer.style.display = 'block';
                    videoPlayer.play().catch(e => console.log('Auto-play prevented:', e));
                    
                } else if (data.error === 'IP_BLOCKED' || data.needsCaptcha) {
                    // CAPTCHA مطلوب - فتح الرابط تلقائياً
                    showResult(\`⚠️ <strong>يطلب الموقع تأكيد أنك إنسان (CAPTCHA)</strong><br><br>
                    🔗 جاري فتح الرابط في نافذة جديدة...<br>
                    بعد إكمال التحقق، سيتم تشغيل الفيديو.<br><br>
                    <a href="\${url}" target="_blank" class="link">إذا لم يتم فتح النافذة، اضغط هنا</a>\`, 'info');
                    
                    // فتح الرابط تلقائياً في نافذة جديدة
                    setTimeout(() => {
                        window.open(url, '_blank');
                    }, 1000);
                    
                } else {
                    // فشل آخر
                    showResult(\`❌ <strong>فشل الاستخراج</strong><br><br>\${data.error || 'خطأ غير معروف'}\`, 'error');
                }
                
            } catch (error) {
                console.error('Error:', error);
                showResult(\`❌ <strong>خطأ في الاتصال</strong><br><br>\${error.message}\`, 'error');
            } finally {
                // إعادة زر الاستخراج
                extractBtn.disabled = false;
                extractBtn.querySelector('.button-text').innerHTML = '<span>🔍 استخراج الرابط</span>';
            }
        }
        
        function showResult(message, type) {
            resultDiv.innerHTML = message;
            resultDiv.className = \`result \${type} show\`;
        }
        
        // استخراج عند الضغط على Enter
        urlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                extract();
            }
        });
        
        extractBtn.addEventListener('click', extract);
    </script>
</body>
</html>
    `);
});

// ============= تشغيل السيرفر =============

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 السيرفر يعمل على http://localhost:${PORT}`);
    console.log(`🔐 كشف CAPTCHA: مفعل`);
    console.log(`📱 صفحة الاختبار: http://localhost:${PORT}`);
});
