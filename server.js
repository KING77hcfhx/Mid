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

// ============= دوال الكشف الجديدة =============

function isCaptchaPage(html) {
    return html.includes('recaptcha') || 
           html.includes('verify you are human') ||
           html.includes('Help us verify you are human') ||
           html.includes('g-recaptcha-response') ||
           html.includes('I\'m not a robot');
}

function isVideoLink(link) {
    if (!link) return false;
    // الروابط الصحيحة للفيديو
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
            
            // 🔥 التحقق من وجود CAPTCHA
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
            
            // 🔥 التحقق: هل الرابط المستخرج هو فيديو حقيقي؟
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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 السيرفر يعمل على http://localhost:${PORT}`);
    console.log(`🔐 كشف CAPTCHA: مفعل`);
});
