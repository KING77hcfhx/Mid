const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3800;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =============== قوائم الهجوم ===============

// قائمة وكيلات (User Agents) حقيقية
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1'
];

// قائمة بقيم Accept-Language
const acceptLanguages = [
    'en-US,en;q=0.9,ar;q=0.8',
    'ar-SA,ar;q=0.9,en;q=0.8',
    'en-US,en;q=0.9',
    'ar,en;q=0.9',
    'fr-FR,fr;q=0.9,en;q=0.8',
    'de-DE,de;q=0.9,en;q=0.8'
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

// قائمة بروابط مرجعية (Referrers) مختلفة
const referrers = [
    'https://www.google.com/',
    'https://www.facebook.com/',
    'https://twitter.com/',
    'https://www.youtube.com/',
    'https://www.reddit.com/',
    'https://www.mediafire.com/',
    'https://www.bing.com/',
    'https://duckduckgo.com/'
];

// قائمة بـ IPs سبوفينج (اختياري - يشتغل مع بعض السيرفرات)
const xForwardedFor = [
    '192.168.1.1',
    '10.0.0.1',
    '172.16.0.1',
    '8.8.8.8',
    '1.1.1.1'
];

/**
 * الحصول على رؤوس عشوائية لكل طلب
 */
function getRandomHeaders() {
    return {
        'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': acceptLanguages[Math.floor(Math.random() * acceptLanguages.length)],
        'Accept-Encoding': acceptEncodings[Math.floor(Math.random() * acceptEncodings.length)],
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Sec-Ch-Ua': secChUa[Math.floor(Math.random() * secChUa.length)],
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': Math.random() > 0.5 ? '"Windows"' : '"macOS"',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'DNT': '1',
        'Referer': referrers[Math.floor(Math.random() * referrers.length)],
        'X-Forwarded-For': xForwardedFor[Math.floor(Math.random() * xForwardedFor.length)],
        'X-Real-IP': `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`
    };
}

/**
 * تأخير عشوائي بين الهجمات
 */
function randomDelay(min = 500, max = 3000) {
    return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
}

/**
 * هجوم متعدد المحاولات لاستخراج الرابط
 */
async function extractWithAttack(mediafireUrl, maxAttempts = 5) {
    console.log(`\n🎯 بدء سلسلة هجمات على: ${mediafireUrl}`);
    console.log(`📊 عدد المحاولات: ${maxAttempts}`);
    
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        console.log(`\n⚔️ الهجوم رقم ${attempt}/${maxAttempts}`);
        
        // تغيير الرؤوس في كل محاولة
        const headers = getRandomHeaders();
        console.log(`📱 User-Agent ${attempt}: ${headers['User-Agent'].substring(0, 40)}...`);
        console.log(`🌐 Referer ${attempt}: ${headers['Referer']}`);
        
        // تأخير عشوائي بين الهجمات (تجنب الاكتشاف)
        if (attempt > 1) {
            const delay = randomDelay(1000, 4000);
            console.log(`⏳ انتظار ${Math.round(delay/1000)} ثواني قبل الهجوم التالي...`);
            await delay;
        }
        
        try {
            // الهجوم: طلب الصفحة
            const { data: html } = await axios.get(mediafireUrl, {
                headers: headers,
                timeout: 15000,
                maxRedirects: 5,
                withCredentials: true,
                // محاكاة أخطاء بسيطة أحياناً (سلوك بشري)
                validateStatus: status => status < 500
            });
            
            // التحقق من reCAPTCHA
            if (html.includes('recaptcha') || html.includes('verify') || html.includes('I\'m not a robot')) {
                console.log(`🤖 تم اكتشاف CAPTCHA في الهجوم ${attempt}`);
                
                // محاولة استخراج الرابط رغم CAPTCHA
                const directLink = extractLinkFromHtml(html);
                if (directLink) {
                    console.log(`✅ نجح الهجوم ${attempt} رغم CAPTCHA!`);
                    return { success: true, directLink: directLink, attempt: attempt };
                }
                continue;
            }
            
            // محاولة استخراج الرابط
            const directLink = extractLinkFromHtml(html);
            if (directLink) {
                console.log(`✅ نجح الهجوم ${attempt}!`);
                return { success: true, directLink: directLink, attempt: attempt };
            }
            
            // إذا لم نجد رابط، جرب طريقة مختلفة
            console.log(`⚠️ الهجوم ${attempt} فشل في العثور على رابط`);
            
            // محاولة البحث في النصوص البرمجية
            const scriptLink = extractFromScripts(html);
            if (scriptLink) {
                console.log(`✅ تم العثور على رابط في النصوص البرمجية (هجوم ${attempt})`);
                return { success: true, directLink: scriptLink, attempt: attempt };
            }
            
            lastError = 'لم يتم العثور على رابط مباشر';
            
        } catch (error) {
            console.log(`💥 الهجوم ${attempt} فشل: ${error.message}`);
            lastError = error.message;
            
            // إذا كان خطأ 403 أو 429 (ممنوع أو طلبات كثيرة)
            if (error.response && (error.response.status === 403 || error.response.status === 429)) {
                console.log(`🚫 تم حظر الهجوم ${attempt}، انتظار أطول...`);
                await randomDelay(3000, 6000);
            }
        }
    }
    
    console.log(`\n❌ فشلت جميع الهجمات ${maxAttempts}`);
    return { success: false, error: lastError || 'فشلت جميع محاولات الاختراق' };
}

/**
 * استخراج الرابط من HTML
 */
function extractLinkFromHtml(html) {
    const $ = cheerio.load(html);
    
    // قائمة بطرق الاستخراج
    const selectors = [
        '#downloadButton',
        'a.downloadButton',
        'a#download_link',
        'a[aria-label="Download file"]',
        'div.download_link a',
        'a.btn-primary',
        'a[href*="download"]',
        'a[href*="mediafire.com/file/"]',
        '[data-download-url]',
        '[data-link]'
    ];
    
    for (const selector of selectors) {
        const element = $(selector);
        for (let i = 0; i < element.length; i++) {
            const href = $(element[i]).attr('href');
            if (href && href.includes('mediafire.com') && !href.includes('recaptcha')) {
                return normalizeLink(href);
            }
        }
    }
    
    // البحث عن أي رابط يحتوي على download
    let foundLink = null;
    $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && (href.includes('download.mediafire.com') || 
            (href.includes('mediafire.com') && href.includes('/file/')))) {
            foundLink = href;
            return false;
        }
    });
    
    return foundLink ? normalizeLink(foundLink) : null;
}

/**
 * استخراج من النصوص البرمجية
 */
function extractFromScripts(html) {
    const patterns = [
        /"download_link"\s*:\s*"([^"]+)"/i,
        /downloadUrl\s*:\s*['"]([^'"]+)['"]/i,
        /"href"\s*:\s*"([^"]+)"\s*,\s*"label"\s*:\s*"Download/i,
        /https:\/\/download\d+\.mediafire\.com\/[a-z0-9]+\/[a-z0-9]+\/[^'"\s]+/i,
        /window\.location\s*=\s*['"]([^'"]+)['"]/i,
        /setAttribute\('href',\s*['"]([^'"]+)['"]\)/i
    ];
    
    for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
            const link = match[1];
            if (link.includes('mediafire.com')) {
                return normalizeLink(link);
            }
        }
    }
    
    return null;
}

/**
 * تطبيع الرابط
 */
function normalizeLink(link) {
    if (link.startsWith('//')) {
        link = 'https:' + link;
    } else if (link.startsWith('/')) {
        link = 'https://www.mediafire.com' + link;
    }
    link = link.split('?')[0];
    link = link.replace(/&amp;/g, '&');
    return link;
}

// =============== API Endpoints ===============

app.post('/api/extract', async (req, res) => {
    try {
        const { url, maxAttempts = 5 } = req.body;
        
        if (!url) {
            return res.status(400).json({ success: false, error: 'يرجى إرسال رابط MediaFire' });
        }
        
        if (!url.includes('mediafire.com')) {
            return res.status(400).json({ success: false, error: 'الرابط يجب أن يكون من موقع MediaFire' });
        }
        
        console.log(`\n🎯 طلب جديد: ${url}`);
        console.log(`💪 عدد الهجمات: ${maxAttempts}`);
        
        const result = await extractWithAttack(url, parseInt(maxAttempts));
        
        res.json(result);
        
    } catch (error) {
        console.error('❌ خطأ:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/extract', async (req, res) => {
    try {
        const { url, attempts = 5 } = req.query;
        
        if (!url) {
            return res.status(400).json({ success: false, error: 'يرجى إضافة رابط MediaFire' });
        }
        
        if (!url.includes('mediafire.com')) {
            return res.status(400).json({ success: false, error: 'الرابط يجب أن يكون من موقع MediaFire' });
        }
        
        const result = await extractWithAttack(url, parseInt(attempts));
        res.json(result);
        
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        attackModes: 'متعددة',
        userAgents: userAgents.length
    });
});

// =============== الصفحة الرئيسية ===============

app.get('/', (req, res) => {
    const html = `<!DOCTYPE html>
    <html>
    <head>
        <title>🎬 MediaFire Attack Mode - استخراج الفيديوهات</title>
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
            .header h1 span { background: #e74c3c; padding: 5px 15px; border-radius: 30px; font-size: 0.9rem; }
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
                border-bottom: 2px solid #e74c3c;
                padding-bottom: 10px;
            }
            .input-group { margin-bottom: 20px; }
            label { display: block; margin-bottom: 8px; font-weight: bold; color: #555; }
            input[type="text"], select {
                width: 100%;
                padding: 12px 15px;
                border: 2px solid #e0e0e0;
                border-radius: 12px;
                font-size: 14px;
                transition: all 0.3s ease;
            }
            input[type="text"]:focus, select:focus {
                outline: none;
                border-color: #e74c3c;
                box-shadow: 0 0 0 3px rgba(231,76,60,0.1);
            }
            button {
                background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%);
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
            button:hover { transform: translateY(-2px); box-shadow: 0 5px 20px rgba(231,76,60,0.4); }
            button:disabled { opacity: 0.6; cursor: not-allowed; transform: none; }
            .loading { text-align: center; padding: 20px; display: none; }
            .spinner {
                width: 40px;
                height: 40px;
                border: 3px solid #f3f3f3;
                border-top: 3px solid #e74c3c;
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
            .attack-log {
                background: #1a1a2e;
                color: #0f0;
                font-family: monospace;
                font-size: 12px;
                padding: 15px;
                border-radius: 10px;
                margin-top: 15px;
                max-height: 200px;
                overflow-y: auto;
                display: none;
            }
            .examples { margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee; }
            .example-link {
                background: #f0f0f0;
                padding: 8px 12px;
                margin: 5px;
                border-radius: 8px;
                font-size: 12px;
                cursor: pointer;
                display: inline-block;
            }
            .example-link:hover { background: #e0e0e0; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🎬 MediaFire Attack Mode <span>⚔️ هجوم</span></h1>
                <p>سلسلة هجمات متعددة - تغيير الهوية - محاولات اختراق ذكية</p>
            </div>
            <div class="main-content">
                <div class="card">
                    <h2><span>⚔️</span> إعدادات الهجوم</h2>
                    <div class="input-group">
                        <label>🎯 رابط MediaFire:</label>
                        <input type="text" id="mediaUrl" placeholder="https://www.mediafire.com/file/...">
                    </div>
                    <div class="input-group">
                        <label>💪 عدد الهجمات:</label>
                        <select id="attackCount">
                            <option value="3">3 هجمات (سريع)</option>
                            <option value="5" selected>5 هجمات (متوسط)</option>
                            <option value="10">10 هجمات (ثقيل)</option>
                            <option value="15">15 هجوم (شامل)</option>
                        </select>
                    </div>
                    <div class="input-group">
                        <label>🏷️ اسم الفيديو:</label>
                        <input type="text" id="fileName" placeholder="اسم الفيديو">
                    </div>
                    <button id="extractBtn" onclick="startAttack()">⚔️ بدء الهجوم</button>
                    <div class="loading" id="loading"><div class="spinner"></div><p>جاري تنفيذ الهجمات...</p></div>
                    <div class="attack-log" id="attackLog"></div>
                    <div class="error" id="error"></div>
                    <div class="success" id="success"></div>
                    <div class="examples">
                        <h4>📝 روابط تجريبية:</h4>
                        <span class="example-link" onclick="setExample('https://www.mediafire.com/file/j0y5aiqzukgp3zw/One+Piece+001+720p.mp4', 'ون بيس')">🎬 ون بيس</span>
                    </div>
                </div>
                <div class="card">
                    <h2><span>🎬</span> المشغل</h2>
                    <div class="video-container">
                        <video id="videoPlayer" controls>
                            <source id="videoSource" src="" type="video/mp4">
                            <p id="noVideoMsg" style="text-align:center; padding:50px; color:#999;">⚔️ ابدأ الهجوم لاستخراج الرابط</p>
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
            let attackInterval = null;
            
            function addLog(message) {
                const logDiv = document.getElementById('attackLog');
                logDiv.style.display = 'block';
                const time = new Date().toLocaleTimeString();
                logDiv.innerHTML += '<div>[' + time + '] ' + message + '</div>';
                logDiv.scrollTop = logDiv.scrollHeight;
            }
            
            async function startAttack() {
                const url = document.getElementById('mediaUrl').value.trim();
                const attacks = document.getElementById('attackCount').value;
                let fileName = document.getElementById('fileName').value.trim();
                
                if (!url) { showError('الرجاء إدخال رابط'); return; }
                if (!url.includes('mediafire.com')) { showError('الرابط يجب أن يكون من MediaFire'); return; }
                if (!fileName) fileName = 'الفيديو';
                
                document.getElementById('error').style.display = 'none';
                document.getElementById('success').style.display = 'none';
                document.getElementById('attackLog').innerHTML = '';
                document.getElementById('attackLog').style.display = 'block';
                document.getElementById('loading').style.display = 'block';
                document.getElementById('extractBtn').disabled = true;
                
                addLog('🎯 بدء سلسلة هجمات على: ' + url);
                addLog('💪 عدد الهجمات: ' + attacks);
                
                try {
                    const response = await fetch('/api/extract', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ url: url, maxAttempts: parseInt(attacks) })
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        addLog('✅ نجح الهجوم رقم ' + data.attempt + '!');
                        addLog('🔗 الرابط المستخرج: ' + data.directLink.substring(0, 80) + '...');
                        
                        currentVideoUrl = data.directLink;
                        const video = document.getElementById('videoPlayer');
                        const source = document.getElementById('videoSource');
                        source.src = data.directLink;
                        video.load();
                        video.play().catch(e => console.log('auto play:', e));
                        
                        document.getElementById('videoInfo').style.display = 'block';
                        document.getElementById('videoTitle').innerHTML = '🎬 ' + escapeHtml(fileName);
                        document.getElementById('extractedLink').innerHTML = '<strong>🔗 الرابط:</strong><br>' + escapeHtml(data.directLink);
                        showSuccess('✅ تم الاستخراج بنجاح بعد ' + data.attempt + ' هجوم!');
                    } else {
                        addLog('❌ فشلت جميع الهجمات!');
                        showError(data.error || 'فشل استخراج الرابط');
                    }
                } catch (error) {
                    addLog('💥 خطأ: ' + error.message);
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
        </script>
    </body>
    </html>`;
    res.send(html);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 السيرفر يعمل على http://localhost:${PORT}`);
    console.log(`⚔️ وضع الهجوم: مفعل`);
    console.log(`🎯 كل طلب = سلسلة هجمات متعددة`);
    console.log(`🔄 يتم تغيير الهوية في كل هجوم`);
});
