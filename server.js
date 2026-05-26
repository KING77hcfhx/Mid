const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 8080;  // تم التغيير من 3800 إلى 8080

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =============== قوائم متعددة للتمويه ===============

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

const acceptLanguages = [
    'en-US,en;q=0.9,ar;q=0.8',
    'ar-SA,ar;q=0.9,en;q=0.8',
    'en-US,en;q=0.9',
    'ar,en;q=0.9',
    'fr-FR,fr;q=0.9,en;q=0.8'
];

const referrers = [
    'https://www.google.com/',
    'https://www.facebook.com/',
    'https://twitter.com/',
    'https://www.youtube.com/',
    'https://www.reddit.com/',
    'https://www.mediafire.com/'
];

const secChUa = [
    '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
    '"Chromium";v="120", "Not(A:Brand";v="24", "Google Chrome";v="120"'
];

/**
 * إنشاء بصمة رقمية جديدة تماماً لكل طلب
 */
function generateFingerprint() {
    return {
        sessionId: crypto.randomBytes(32).toString('hex'),
        deviceId: crypto.randomBytes(16).toString('hex'),
        timestamp: Date.now(),
        random: Math.random().toString(36).substring(2, 15)
    };
}

/**
 * رؤوس HTTP جديدة بالكامل لكل طلب
 */
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
        'Cookie': `__cf_bm=${fp.sessionId}; _ga=GA1.2.${Math.floor(Math.random() * 9999999)}.${fp.timestamp}; _gid=GA1.2.${Math.floor(Math.random() * 9999999)}.${fp.timestamp}; device_id=${fp.deviceId}; session=${fp.random}`,
        'X-Requested-With': 'XMLHttpRequest'
    };
}

/**
 * تأخير عشوائي قصير
 */
function randomDelay(min = 300, max = 1200) {
    return new Promise(resolve => setTimeout(resolve, Math.random() * (max - min) + min));
}

/**
 * استخراج الرابط مع تجديد كامل للهوية
 */
async function extractDirectLink(mediafireUrl) {
    console.log(`\n🔍 بدء استخراج الرابط: ${mediafireUrl}`);
    
    let lastError = null;
    
    // 3 محاولات بهويات مختلفة
    for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`\n📡 محاولة ${attempt}/3 - تجديد الهوية بالكامل...`);
        
        const headers = getFreshHeaders();
        console.log(`   👤 User-Agent: ${headers['User-Agent'].substring(0, 50)}...`);
        console.log(`   🍪 Session: ${headers['Cookie'].substring(0, 40)}...`);
        
        if (attempt > 1) {
            const delay = randomDelay(1000, 2500);
            console.log(`   ⏳ انتظار ${Math.round(delay/1000)} ثانية...`);
            await delay;
        }
        
        try {
            const { data: html } = await axios.get(mediafireUrl, {
                headers: headers,
                timeout: 15000,
                maxRedirects: 5,
                withCredentials: true,
                params: { _t: Date.now(), _r: Math.random() }
            });
            
            if (html.includes('recaptcha') || html.includes('verify') || html.includes('I\'m not a robot')) {
                console.log(`   🤖 تم اكتشاف CAPTCHA في المحاولة ${attempt}`);
                
                const link = extractLinkFromHtml(html);
                if (link) {
                    console.log(`   ✅ تم استخراج رابط رغم CAPTCHA!`);
                    return { success: true, directLink: link, attempt: attempt };
                }
                continue;
            }
            
            const directLink = extractLinkFromHtml(html);
            if (directLink) {
                console.log(`   ✅ نجحت المحاولة ${attempt}!`);
                return { success: true, directLink: directLink, attempt: attempt };
            }
            
            const scriptLink = extractFromScripts(html);
            if (scriptLink) {
                console.log(`   ✅ تم استخراج من script في المحاولة ${attempt}`);
                return { success: true, directLink: scriptLink, attempt: attempt };
            }
            
            console.log(`   ⚠️ لم يتم العثور على رابط في المحاولة ${attempt}`);
            lastError = 'لم يتم العثور على رابط';
            
        } catch (error) {
            console.log(`   ❌ خطأ في المحاولة ${attempt}: ${error.message}`);
            lastError = error.message;
        }
    }
    
    console.log(`\n❌ فشلت جميع المحاولات`);
    return { success: false, error: lastError || 'فشل الاستخراج' };
}

/**
 * استخراج الرابط من HTML
 */
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
        'a[href*="mediafire.com/file/"]'
    ];
    
    for (const selector of selectors) {
        const href = $(selector).attr('href');
        if (href && href.includes('mediafire.com') && !href.includes('recaptcha')) {
            return normalizeLink(href);
        }
    }
    
    let found = null;
    $('a').each((i, el) => {
        const href = $(el).attr('href');
        if (href && (href.includes('download.mediafire.com') || 
            (href.includes('mediafire.com') && href.includes('/file/')))) {
            found = href;
            return false;
        }
    });
    
    return found ? normalizeLink(found) : null;
}

/**
 * استخراج من النصوص البرمجية
 */
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
    if (link.startsWith('//')) link = 'https:' + link;
    if (link.startsWith('/')) link = 'https://www.mediafire.com' + link;
    return link.split('?')[0].replace(/&amp;/g, '&');
}

// =============== API ===============

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
        timestamp: new Date().toISOString(),
        message: 'كل طلب بهوية جديدة تماماً'
    });
});

// =============== صفحة رئيسية بسيطة ===============

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>MediaFire Extractor - وضع الاختراق</title>
        <meta charset="UTF-8">
        <style>
            body { font-family: Arial; max-width: 800px; margin: 50px auto; padding: 20px; }
            input, button { padding: 10px; margin: 10px 0; width: 100%; }
            button { background: #007bff; color: white; border: none; cursor: pointer; }
            .result { margin-top: 20px; padding: 15px; background: #f0f0f0; border-radius: 8px; word-break: break-all; }
            video { width: 100%; margin-top: 20px; }
        </style>
    </head>
    <body>
        <h1>🎬 MediaFire Video Extractor</h1>
        <p>كل طلب = هوية جديدة + بصمة مختلفة + تجديد كامل للجلسة</p>
        
        <input type="text" id="url" placeholder="رابط MediaFire...">
        <button onclick="extract()">استخراج وتشغيل</button>
        
        <div id="result" class="result" style="display:none;"></div>
        <video id="player" controls style="display:none;"></video>
        
        <script>
            async function extract() {
                const url = document.getElementById('url').value;
                if(!url) return alert('ادخل رابط');
                
                document.getElementById('result').style.display = 'block';
                document.getElementById('result').innerHTML = 'جاري الاستخراج...';
                
                const res = await fetch('/api/extract', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({url})
                });
                const data = await res.json();
                
                if(data.success) {
                    document.getElementById('result').innerHTML = '✅ الرابط: <br><a href="'+data.directLink+'" target="_blank">'+data.directLink+'</a>';
                    const video = document.getElementById('player');
                    video.src = data.directLink;
                    video.style.display = 'block';
                    video.play();
                } else {
                    document.getElementById('result').innerHTML = '❌ خطأ: '+data.error;
                }
            }
        </script>
    </body>
    </html>
    `);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 السيرفر يعمل على http://localhost:${PORT}`);
    console.log(`🔐 وضع التمويه: مفعل 100%`);
    console.log(`🍪 كل طلب = هوية جديدة + كوكيز جديدة + بصمة جديدة`);
});
