const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// كاش لتخزين النتائج مؤقتًا
const cache = new Map();
const CACHE_DURATION = 4 * 60 * 60 * 1000; // 4 ساعات

// قائمة وكيلات (User Agents) حقيقية
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15'
];

// قائمة بقيم Accept-Language
const acceptLanguages = [
    'en-US,en;q=0.9,ar;q=0.8',
    'ar-SA,ar;q=0.9,en;q=0.8',
    'en-US,en;q=0.9',
    'ar,en;q=0.9',
];

// قائمة بــ Accept-Encoding
const acceptEncodings = [
    'gzip, deflate, br',
    'gzip, deflate',
    'br, gzip, deflate'
];

// قائمة بــ Sec-Ch-Ua
const secChUa = [
    '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
    '"Chromium";v="120", "Not(A:Brand";v="24", "Google Chrome";v="120"'
];

/**
 * الحصول على رؤوس عشوائية تشبه مستخدم حقيقي
 */
function getRandomHeaders() {
    const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
    const randomAcceptLang = acceptLanguages[Math.floor(Math.random() * acceptLanguages.length)];
    const randomAcceptEncoding = acceptEncodings[Math.floor(Math.random() * acceptEncodings.length)];
    const randomSecChUa = secChUa[Math.floor(Math.random() * secChUa.length)];
    
    // إنشاء معرف جلسة عشوائي (Session ID)
    const sessionId = crypto.randomBytes(16).toString('hex');
    
    // إنشاء معرف تتبع عشوائي (Fingerprint)
    const fingerprint = crypto.randomBytes(8).toString('hex');
    
    return {
        'User-Agent': randomUA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': randomAcceptLang,
        'Accept-Encoding': randomAcceptEncoding,
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Sec-Ch-Ua': randomSecChUa,
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Cache-Control': 'max-age=0',
        'DNT': '1',
        'Referer': 'https://www.google.com/',
        'Cookie': `session_id=${sessionId}; fingerprint=${fingerprint}; _ga=GA1.2.${Math.floor(Math.random() * 10000000)}.${Date.now()}; _gid=GA1.2.${Math.floor(Math.random() * 10000000)}.${Date.now()}`
    };
}

/**
 * تأخير عشوائي لمحاكاة السلوك البشري
 */
function randomDelay(min = 500, max = 2000) {
    return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
}

/**
 * استخراج الرابط المباشر من MediaFire مع محاكاة سلوك بشري
 */
async function extractDirectLink(mediafireUrl) {
    try {
        console.log(`🔍 جاري تحليل الرابط: ${mediafireUrl}`);
        
        // تأخير عشوائي أولي
        await randomDelay(800, 1500);
        
        // المحاولة الأولى: طلب عادي
        let headers = getRandomHeaders();
        console.log(`📱 باستخدام User-Agent: ${headers['User-Agent'].substring(0, 50)}...`);
        
        const { data: html } = await axios.get(mediafireUrl, {
            headers: headers,
            timeout: 15000,
            maxRedirects: 5,
            // محاكاة المتصفح في قبول الكوكيز
            withCredentials: true
        });
        
        // تأخير بعد استلام الصفحة
        await randomDelay(300, 800);
        
        // التحقق من وجود reCAPTCHA
        if (html.includes('recaptcha') || html.includes('verify') || html.includes('I\'m not a robot')) {
            console.log(`⚠️ تم اكتشاف reCAPTCHA، محاولة بطريقة مختلفة...`);
            
            // محاولة ثانية مع رؤوس مختلفة وتأخير أطول
            await randomDelay(2000, 4000);
            
            headers = getRandomHeaders();
            headers['Referer'] = mediafireUrl;
            
            const { data: htmlRetry } = await axios.get(mediafireUrl, {
                headers: headers,
                timeout: 20000,
                maxRedirects: 5
            });
            
            // محاولة استخراج الرابط رغم CAPTCHA
            const directLink = tryExtractWithoutCaptcha(htmlRetry);
            if (directLink) {
                console.log(`✅ تم استخراج الرابط رغم وجود CAPTCHA`);
                return {
                    success: true,
                    directLink: directLink,
                    note: 'تم الاستخراج رغم وجود CAPTCHA',
                    timestamp: Date.now()
                };
            }
            
            return {
                success: false,
                error: 'الملف محمي بـ reCAPTCHA. يرجى المحاولة لاحقاً أو استخدام رابط آخر.',
                requiresCaptcha: true
            };
        }
        
        // استخراج الرابط المباشر
        const result = parseMediaFirePage(html, mediafireUrl);
        
        if (result.success) {
            // تأخير قبل إرجاع النتيجة
            await randomDelay(200, 500);
            return result;
        }
        
        // محاولة ثالثة مع رؤوس مختلفة
        console.log(`🔄 محاولة ثالثة بطريقة مختلفة...`);
        await randomDelay(1500, 2500);
        
        headers = getRandomHeaders();
        headers['Referer'] = 'https://www.mediafire.com/';
        
        const { data: htmlThird } = await axios.get(mediafireUrl, {
            headers: headers,
            timeout: 15000
        });
        
        const resultThird = parseMediaFirePage(htmlThird, mediafireUrl);
        
        if (resultThird.success) {
            return resultThird;
        }
        
        return { success: false, error: 'فشل استخراج الرابط بعد عدة محاولات' };
        
    } catch (error) {
        console.error(`❌ خطأ: ${error.message}`);
        return {
            success: false,
            error: `فشل الاتصال: ${error.message}`
        };
    }
}

/**
 * محاولة استخراج الرابط رغم وجود CAPTCHA
 */
function tryExtractWithoutCaptcha(html) {
    const $ = cheerio.load(html);
    
    // البحث عن الروابط المباشرة في الصفحة
    const patterns = [
        /download\.mediafire\.com\/[a-z0-9]+\/[a-z0-9]+\/[^'"\s]+/gi,
        /https?:\/\/download\d+\.mediafire\.com\/[^'"\s]+\.mp4/gi,
        /https?:\/\/download\d+\.mediafire\.com\/[^'"\s]+\.mkv/gi,
        /"link"\s*:\s*"([^"]+download[^"]+)"/gi,
        /href="([^"]*download[^"]*)"/gi,
        /window\.location\s*=\s*['"]([^'"]+)['"]/gi,
        /setAttribute\('href',\s*['"]([^'"]+)['"]\)/gi
    ];
    
    for (const pattern of patterns) {
        const matches = html.match(pattern);
        if (matches && matches.length > 0) {
            let link = matches[0];
            if (!link.startsWith('http')) {
                link = 'https://' + link;
            }
            link = link.replace(/&amp;/g, '&');
            if (link.includes('mediafire.com') && (link.includes('download') || link.includes('/file/'))) {
                return link;
            }
        }
    }
    
    return null;
}

/**
 * تحليل صفحة MediaFire
 */
function parseMediaFirePage(html, originalUrl) {
    const $ = cheerio.load(html);
    
    const extractors = [
        () => $('#downloadButton').attr('href'),
        () => $('a.downloadButton').attr('href'),
        () => $('a#download_link').attr('href'),
        () => $('a[aria-label="Download file"]').attr('href'),
        () => $('div.download_link a').attr('href'),
        () => $('a.btn-primary').attr('href'),
        () => {
            let link = null;
            $('a').each((i, el) => {
                const href = $(el).attr('href');
                if (href && (href.includes('download.mediafire.com') || href.includes('/download/'))) {
                    link = href;
                    return false;
                }
            });
            return link;
        },
        () => {
            let link = null;
            $('script').each((i, script) => {
                const content = $(script).html();
                if (content) {
                    const match = content.match(/(?:downloadUrl|download_link|href)\s*[:=]\s*["']([^"']+\.mediafire\.com[^"']+)["']/i);
                    if (match) {
                        link = match[1];
                        return false;
                    }
                }
            });
            return link;
        },
        // البحث في data属性
        () => $('[data-download-url]').attr('data-download-url'),
        () => $('[data-link]').attr('data-link')
    ];
    
    for (const extractor of extractors) {
        const link = extractor();
        if (link && link.includes('mediafire.com')) {
            let finalLink = link;
            if (link.startsWith('//')) finalLink = 'https:' + link;
            if (link.startsWith('/')) finalLink = 'https://www.mediafire.com' + link;
            
            // تنظيف الرابط
            finalLink = finalLink.split('?')[0];
            
            console.log(`✅ تم استخراج: ${finalLink.substring(0, 100)}...`);
            return { success: true, directLink: finalLink, timestamp: Date.now() };
        }
    }
    
    return { success: false, error: 'لم يتم العثور على رابط مباشر' };
}

/**
 * التحقق من صحة الرابط المباشر
 */
async function validateDirectLink(directLink) {
    try {
        const headers = getRandomHeaders();
        const response = await axios.head(directLink, {
            headers: headers,
            timeout: 8000,
            maxRedirects: 3
        });
        return response.status === 200 || response.status === 302;
    } catch (error) {
        console.log(`⚠️ فشل التحقق من الرابط: ${error.message}`);
        return false;
    }
}

/**
 * تنظيف الكاش
 */
function cleanupCache() {
    const now = Date.now();
    let deletedCount = 0;
    for (const [key, value] of cache.entries()) {
        if (now - value.timestamp > CACHE_DURATION) {
            cache.delete(key);
            deletedCount++;
        }
    }
    console.log(`🧹 تنظيف الكاش: حذف ${deletedCount} عنصر، المتبقي: ${cache.size}`);
}

setInterval(cleanupCache, 2 * 60 * 60 * 1000);

// =============== الصفحة الرئيسية ===============

app.get('/', (req, res) => {
    const html = `<!DOCTYPE html>
    <html>
    <head>
        <title>🎬 MediaFire Video Player - تشغيل آمن</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%);
                min-height: 100vh;
                padding: 20px;
            }
            .container { max-width: 1300px; margin: 0 auto; }
            .header { text-align: center; margin-bottom: 30px; }
            .header h1 { color: white; font-size: 2rem; margin-bottom: 10px; }
            .header p { color: rgba(255,255,255,0.7); }
            .main-content { display: grid; grid-template-columns: 1fr 1fr; gap: 25px; }
            @media (max-width: 900px) { .main-content { grid-template-columns: 1fr; } }
            .card {
                background: rgba(255,255,255,0.95);
                border-radius: 20px;
                padding: 25px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.3);
            }
            .card h2 {
                color: #333;
                margin-bottom: 20px;
                display: flex;
                align-items: center;
                gap: 10px;
                border-bottom: 2px solid #667eea;
                padding-bottom: 10px;
            }
            .input-group { margin-bottom: 20px; }
            label { display: block; margin-bottom: 8px; font-weight: bold; color: #555; }
            input[type="text"] {
                width: 100%;
                padding: 12px 15px;
                border: 2px solid #e0e0e0;
                border-radius: 12px;
                font-size: 14px;
                transition: all 0.3s ease;
            }
            input[type="text"]:focus {
                outline: none;
                border-color: #667eea;
                box-shadow: 0 0 0 3px rgba(102,126,234,0.1);
            }
            button {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border: none;
                padding: 12px 25px;
                border-radius: 12px;
                font-size: 16px;
                font-weight: bold;
                cursor: pointer;
                transition: all 0.3s ease;
                width: 100%;
            }
            button:hover { transform: translateY(-2px); box-shadow: 0 5px 20px rgba(102,126,234,0.4); }
            button:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
            .loading { text-align: center; padding: 20px; display: none; }
            .spinner {
                width: 40px;
                height: 40px;
                border: 3px solid #f3f3f3;
                border-top: 3px solid #667eea;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
                margin: 0 auto 10px;
            }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            .video-container { background: #000; border-radius: 12px; overflow: hidden; }
            video { width: 100%; max-height: 400px; display: block; }
            .video-info { padding: 15px; background: #f8f9fa; }
            .video-title { font-size: 1.1rem; font-weight: bold; color: #333; word-break: break-all; margin-bottom: 10px; }
            .video-controls { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
            .btn-small { background: #3498db; padding: 8px 15px; font-size: 13px; width: auto; }
            .btn-small:hover { background: #2980b9; }
            .btn-download { background: #27ae60; }
            .btn-download:hover { background: #219a52; }
            .extracted-link { margin-top: 15px; padding: 10px; background: #e8f4f8; border-radius: 8px; font-size: 12px; word-break: break-all; font-family: monospace; }
            .error { background: #fee; border: 1px solid #fcc; color: #c33; padding: 12px; border-radius: 10px; margin-top: 15px; display: none; }
            .success { background: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 12px; border-radius: 10px; margin-top: 15px; display: none; }
            .examples { margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee; }
            .examples h4 { margin-bottom: 10px; color: #555; }
            .example-link {
                background: #f0f0f0;
                padding: 8px 12px;
                margin: 5px;
                border-radius: 8px;
                font-size: 12px;
                cursor: pointer;
                display: inline-block;
                transition: all 0.2s;
            }
            .example-link:hover { background: #e0e0e0; transform: scale(1.02); }
            .cache-badge { background: #17a2b8; color: white; padding: 3px 10px; border-radius: 20px; font-size: 11px; display: inline-block; margin-left: 10px; }
            .security-note { background: #fff3cd; border: 1px solid #ffeeba; color: #856404; padding: 10px; border-radius: 8px; margin-top: 15px; font-size: 12px; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🎬 MediaFire Video Player <span style="font-size:14px;">🛡️ تشغيل آمن</span></h1>
                <p>استخراج وتشغيل فيديوهات MediaFire - تقنية محاكاة المتصفح البشري</p>
            </div>
            <div class="main-content">
                <div class="card">
                    <h2><span>📥</span> استخراج الرابط</h2>
                    <div class="input-group">
                        <label>🔗 رابط MediaFire:</label>
                        <input type="text" id="mediaUrl" placeholder="https://www.mediafire.com/file/...">
                    </div>
                    <div class="input-group">
                        <label>🏷️ اسم الفيديو (اختياري):</label>
                        <input type="text" id="fileName" placeholder="اسم الفيديو">
                    </div>
                    <button id="extractBtn" onclick="extractAndPlay()">🚀 استخراج وتشغيل</button>
                    <div class="loading" id="loading"><div class="spinner"></div><p>جاري استخراج الرابط مع محاكاة متصفح حقيقي...</p></div>
                    <div class="error" id="error"></div>
                    <div class="success" id="success"></div>
                    <div class="security-note">
                        🔒 <strong>تقنيات أمان متقدمة:</strong> محاكاة User-Agent متغيرة، تأخيرات عشوائية، رؤوس HTTP حقيقية، وكيل عشوائي
                    </div>
                    <div class="examples">
                        <h4>📝 روابط تجريبية:</h4>
                        <span class="example-link" onclick="setExample('https://www.mediafire.com/file/j0y5aiqzukgp3zw/One+Piece+001+720p.mp4', 'ون بيس - الحلقة 1')">🎬 ون بيس حلقة 1</span>
                    </div>
                </div>
                <div class="card">
                    <h2><span>🎬</span> المشغل <span id="cacheBadge" class="cache-badge" style="display:none;">📦 من الكاش</span></h2>
                    <div class="video-container">
                        <video id="videoPlayer" controls controlsList="nodownload">
                            <source id="videoSource" src="" type="video/mp4">
                            <p id="noVideoMsg" style="text-align:center; padding:50px; color:#999;">⬅️ أدخل رابط MediaFire واضغط استخراج</p>
                        </video>
                    </div>
                    <div class="video-info" id="videoInfo" style="display:none;">
                        <div class="video-title" id="videoTitle"></div>
                        <div class="video-controls">
                            <button class="btn-small" onclick="togglePlay()">⏯️ تشغيل/إيقاف</button>
                            <button class="btn-small" onclick="fullscreen()">🖥️ ملء الشاشة</button>
                            <button class="btn-small btn-download" onclick="downloadVideo()">⬇️ تحميل</button>
                        </div>
                        <div class="extracted-link" id="extractedLink"></div>
                    </div>
                </div>
            </div>
        </div>
        <script>
            let currentVideoUrl = '';
            async function extractAndPlay() {
                const url = document.getElementById('mediaUrl').value.trim();
                let fileName = document.getElementById('fileName').value.trim();
                if (!url) { showError('الرجاء إدخال رابط MediaFire'); return; }
                if (!url.includes('mediafire.com')) { showError('الرابط يجب أن يكون من موقع MediaFire'); return; }
                if (!fileName) fileName = 'الفيديو';
                document.getElementById('error').style.display = 'none';
                document.getElementById('success').style.display = 'none';
                document.getElementById('cacheBadge').style.display = 'none';
                document.getElementById('loading').style.display = 'block';
                document.getElementById('extractBtn').disabled = true;
                try {
                    const response = await fetch('/api/extract', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: url })
                    });
                    const data = await response.json();
                    if (data.success) {
                        currentVideoUrl = data.directLink;
                        if (data.cached) {
                            document.getElementById('cacheBadge').style.display = 'inline-block';
                            showSuccess('📦 من الكاش | متبقي: ' + data.cacheExpiresIn);
                        }
                        const video = document.getElementById('videoPlayer');
                        const source = document.getElementById('videoSource');
                        source.src = data.directLink;
                        video.load();
                        video.play().catch(e => console.log('تشغيل تلقائي:', e));
                        document.getElementById('videoInfo').style.display = 'block';
                        document.getElementById('videoTitle').innerHTML = '🎬 ' + escapeHtml(fileName);
                        document.getElementById('extractedLink').innerHTML = '<strong>🔗 الرابط:</strong><br>' + escapeHtml(data.directLink);
                    } else {
                        showError(data.error || 'فشل استخراج الرابط');
                    }
                } catch (error) {
                    showError('خطأ: ' + error.message);
                } finally {
                    document.getElementById('loading').style.display = 'none';
                    document.getElementById('extractBtn').disabled = false;
                }
            }
            function togglePlay() { const v = document.getElementById('videoPlayer'); v.paused ? v.play() : v.pause(); }
            function fullscreen() { const v = document.getElementById('videoPlayer'); v.requestFullscreen?.() || v.webkitRequestFullscreen?.(); }
            function downloadVideo() { if (currentVideoUrl) window.open(currentVideoUrl, '_blank'); }
            function showError(m) { const e = document.getElementById('error'); e.innerHTML = '❌ ' + m; e.style.display = 'block'; setTimeout(() => e.style.display = 'none', 5000); }
            function showSuccess(m) { const s = document.getElementById('success'); s.innerHTML = '✅ ' + m; s.style.display = 'block'; setTimeout(() => s.style.display = 'none', 4000); }
            function setExample(url, name) { document.getElementById('mediaUrl').value = url; document.getElementById('fileName').value = name; }
            function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
            document.getElementById('mediaUrl').addEventListener('keypress', e => { if (e.key === 'Enter') extractAndPlay(); });
        </script>
    </body>
    </html>`;
    res.send(html);
});

// =============== API ===============

app.post('/api/extract', async (req, res) => {
    try {
        const { url, cacheKey } = req.body;
        if (!url) return res.status(400).json({ success: false, error: 'يرجى إرسال رابط MediaFire' });
        if (!url.includes('mediafire.com')) return res.status(400).json({ success: false, error: 'الرابط يجب أن يكون من موقع MediaFire' });
        
        const cacheKeyToUse = cacheKey || url;
        const cachedResult = cache.get(cacheKeyToUse);
        
        if (cachedResult && (Date.now() - cachedResult.timestamp < CACHE_DURATION)) {
            const expiresInMinutes = Math.round((CACHE_DURATION - (Date.now() - cachedResult.timestamp)) / 1000 / 60);
            return res.json({ ...cachedResult, cached: true, cacheExpiresIn: expiresInMinutes + ' دقيقة' });
        }
        
        const result = await extractDirectLink(url);
        if (result.success) cache.set(cacheKeyToUse, result);
        res.json(result);
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/extract', async (req, res) => {
    try {
        const { url, cacheKey } = req.query;
        if (!url) return res.status(400).json({ success: false, error: 'يرجى إضافة رابط MediaFire' });
        if (!url.includes('mediafire.com')) return res.status(400).json({ success: false, error: 'الرابط يجب أن يكون من موقع MediaFire' });
        
        const cacheKeyToUse = cacheKey || url;
        const cachedResult = cache.get(cacheKeyToUse);
        
        if (cachedResult && (Date.now() - cachedResult.timestamp < CACHE_DURATION)) {
            const expiresInMinutes = Math.round((CACHE_DURATION - (Date.now() - cachedResult.timestamp)) / 1000 / 60);
            return res.json({ ...cachedResult, cached: true, cacheExpiresIn: expiresInMinutes + ' دقيقة' });
        }
        
        const result = await extractDirectLink(url);
        if (result.success) cache.set(cacheKeyToUse, result);
        res.json(result);
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString(), cacheSize: cache.size, cacheDuration: '4 ساعات' });
});

app.delete('/api/cache', (req, res) => {
    const { key } = req.query;
    if (key) { cache.delete(key); res.json({ success: true, message: `تم حذف ${key}` }); }
    else { cache.clear(); res.json({ success: true, message: 'تم مسح الكاش' }); }
});

app.use((err, req, res, next) => {
    console.error('❌ خطأ:', err.stack);
    res.status(500).json({ success: false, error: 'خطأ داخلي: ' + err.message });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 السيرفر يعمل على http://localhost:${PORT}`);
    console.log(`📌 مدة الكاش: 4 ساعات`);
    console.log(`🛡️ تقنيات الأمان: User-Agent متغير، تأخيرات عشوائية، رؤوس HTTP محاكية`);
});
