require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { chromium } = require('playwright');
const crypto = require('crypto');

// -------------------------------
// الإعدادات الأساسية
// -------------------------------
const PORT = process.env.PORT || 8080;
const CACHE_TTL = parseInt(process.env.CACHE_TTL) || 30 * 60 * 1000; // 30 min
const BROWSER_HEADLESS = process.env.HEADLESS !== 'false';
const PROXY_URL = process.env.PROXY_URL || null;          // مثال: http://user:pass@ip:port
const SESSION_TIMEOUT = parseInt(process.env.SESSION_TIMEOUT) || 60 * 60 * 1000; // 1 hour
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 3;
const CONCURRENT_BROWSERS = parseInt(process.env.CONCURRENT_BROWSERS) || 2;

// -------------------------------
// ذاكرة تخزين مؤقت (Cache)
// -------------------------------
class MemoryCache {
  constructor(ttl) {
    this.cache = new Map();
    this.ttl = ttl;
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }
  set(key, value) {
    this.cache.set(key, { value, timestamp: Date.now() });
  }
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    return entry.value;
  }
  delete(key) { this.cache.delete(key); }
  clear() { this.cache.clear(); }
  size() { return this.cache.size; }
  cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) this.cache.delete(key);
    }
  }
}
const cache = new MemoryCache(CACHE_TTL);

// -------------------------------
// مدير الجلسات (Session Manager)
// -------------------------------
class SessionManager {
  constructor() {
    this.sessions = new Map();       // key -> { context, browser, lastUsed }
    this.browserPool = [];
    this.poolSize = 0;
    this.maxPoolSize = CONCURRENT_BROWSERS;
  }

  async getBrowser() {
    // إعادة استخدام متصفح موجود
    if (this.browserPool.length > 0) {
      return this.browserPool.pop();
    }
    if (this.poolSize >= this.maxPoolSize) {
      // انتظار حتى يتوفر متصفح
      await new Promise(resolve => setTimeout(resolve, 1000));
      return this.getBrowser();
    }
    // إنشاء متصفح جديد
    this.poolSize++;
    const browser = await chromium.launch({
      headless: BROWSER_HEADLESS,
      proxy: PROXY_URL ? { server: PROXY_URL } : undefined,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });
    return browser;
  }

  releaseBrowser(browser) {
    if (this.browserPool.length < this.maxPoolSize) {
      this.browserPool.push(browser);
    } else {
      browser.close().catch(() => {});
      this.poolSize--;
    }
  }

  async getSession(url) {
    const host = new URL(url).hostname;
    // نستخدم نطاق الموقع كمفتاح للجلسة (يمكن تعديله ليكون لكل مستخدم نهائي)
    const sessionKey = host;
    if (this.sessions.has(sessionKey)) {
      const session = this.sessions.get(sessionKey);
      if (Date.now() - session.lastUsed < SESSION_TIMEOUT) {
        session.lastUsed = Date.now();
        return session.context;
      } else {
        // انتهت صلاحية الجلسة – إغلاقها
        await session.context.close();
        await session.browser.close();
        this.sessions.delete(sessionKey);
        this.poolSize--;
      }
    }
    // إنشاء سياق جديد (جلسة نظيفة)
    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
      permissions: ['geolocation'],
      geolocation: { longitude: -74.006, latitude: 40.7128 },
      deviceScaleFactor: 1,
      hasTouch: false,
      isMobile: false,
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
    });
    this.sessions.set(sessionKey, {
      context,
      browser,
      lastUsed: Date.now()
    });
    return context;
  }

  async closeAll() {
    for (const [key, sess] of this.sessions.entries()) {
      await sess.context.close();
      await sess.browser.close();
      this.sessions.delete(key);
    }
    for (const b of this.browserPool) {
      await b.close();
    }
    this.browserPool = [];
    this.poolSize = 0;
  }
}
const sessionManager = new SessionManager();

// -------------------------------
// مستخرج الرابط باستخدام Playwright
// -------------------------------
async function extractDirectLinkWithBrowser(mediafireUrl, retry = 0) {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] 🌐 استخراج: ${mediafireUrl} (محاولة ${retry+1})`);
  let context = null;
  try {
    context = await sessionManager.getSession(mediafireUrl);
    const page = await context.newPage();
    
    // محاكاة سلوك طبيعي: تأخير عشوائي مبدئي
    await page.waitForTimeout(Math.random() * 500 + 200);
    
    // الانتقال إلى الصفحة
    const response = await page.goto(mediafireUrl, {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    
    if (!response || !response.ok()) {
      throw new Error(`HTTP ${response?.status()}`);
    }
    
    // انتظار وجود عناصر التحميل (قد تظهر بعد تشغيل JS)
    await page.waitForSelector('a#downloadButton, a.downloadButton, a#download_link, a[aria-label="Download file"]', { timeout: 15000 }).catch(() => {});
    
    // محاكاة حركة الماوس والتمرير (سلوك بشري)
    await page.mouse.move(Math.random() * 800, Math.random() * 600);
    await page.evaluate(() => window.scrollBy(0, Math.random() * 300 + 100));
    await page.waitForTimeout(Math.random() * 800 + 300);
    
    // البحث عن رابط التحميل المباشر
    let directLink = null;
    
    // الطريقة الأولى: onclick أو href في زر التحميل
    const downloadBtn = await page.$('a#downloadButton, a.downloadButton, a#download_link, a[aria-label="Download file"]');
    if (downloadBtn) {
      const href = await downloadBtn.getAttribute('href');
      if (href) directLink = href;
      else {
        // محاولة النقر إذا كان الزر يشغل JS
        await downloadBtn.click();
        await page.waitForTimeout(2000);
        // بعد النقر قد نحصل على الرابط من الصفحة الجديدة أو من fetch
        const newUrl = page.url();
        if (newUrl !== mediafireUrl && newUrl.includes('download')) directLink = newUrl;
      }
    }
    
    // الطريقة الثانية: استخراج من داخل التطبيقات (JavaScript)
    if (!directLink) {
      directLink = await page.evaluate(() => {
        // البحث في النصوص البرمجية
        const scripts = Array.from(document.querySelectorAll('script'));
        for (let script of scripts) {
          const content = script.innerHTML;
          const match = content.match(/["'](https:\/\/download\d+\.mediafire\.com\/[a-f0-9]+\/[a-f0-9]+\/[^"']+)["']/);
          if (match) return match[1];
        }
        // البحث عن أي رابط يحتوي على download.mediafire.com
        const links = Array.from(document.querySelectorAll('a[href*="download.mediafire.com"]'));
        if (links.length) return links[0].href;
        return null;
      });
    }
    
    // الطريقة الثالثة: متابعة redirects
    if (!directLink && page.url().includes('download')) {
      directLink = page.url();
    }
    
    await page.close();
    
    if (!directLink) {
      throw new Error('لم يتم العثور على رابط مباشر');
    }
    
    // تنظيف الرابط
    if (directLink.startsWith('//')) directLink = 'https:' + directLink;
    if (!directLink.startsWith('http')) directLink = 'https://www.mediafire.com' + directLink;
    
    console.log(`[${new Date().toISOString()}] ✅ تم الاستخراج (${Date.now() - startTime}ms): ${directLink}`);
    return {
      success: true,
      directLink,
      method: 'playwright',
      timestamp: Date.now()
    };
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ فشل: ${error.message}`);
    if (retry < MAX_RETRIES) {
      const delay = Math.pow(2, retry) * 1000 + Math.random() * 1000;
      await new Promise(resolve => setTimeout(resolve, delay));
      return extractDirectLinkWithBrowser(mediafireUrl, retry + 1);
    }
    return {
      success: false,
      error: error.message
    };
  } finally {
    // تحرير السياق ليس فورياً لأن SessionManager يديرها؛ لكننا لا نغلق السياق هنا.
  }
}

// -------------------------------
// خادم Express + API
// -------------------------------
const app = express();
app.use(cors());
app.use(express.json());
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, error: 'Too many requests' }
}));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    cacheSize: cache.size(),
    activeSessions: sessionManager.sessions.size,
    browserPool: sessionManager.browserPool.length
  });
});

app.post('/api/extract', async (req, res) => {
  const { url, bypassCache = false } = req.body;
  if (!url || !url.includes('mediafire.com')) {
    return res.status(400).json({ success: false, error: 'Invalid MediaFire URL' });
  }
  
  const cacheKey = crypto.createHash('md5').update(url).digest('hex');
  if (!bypassCache) {
    const cached = cache.get(cacheKey);
    if (cached) {
      console.log(`[${new Date().toISOString()}] 📦 Cache hit for ${url}`);
      return res.json({ ...cached, cached: true });
    }
  }
  
  const result = await extractDirectLinkWithBrowser(url);
  if (result.success) {
    cache.set(cacheKey, result);
  }
  res.json(result);
});

app.get('/api/extract', async (req, res) => {
  const { url, bypassCache } = req.query;
  if (!url) return res.status(400).json({ success: false, error: 'Missing url parameter' });
  return app.handle({ method: 'POST', body: { url, bypassCache: bypassCache === 'true' }, headers: req.headers }, res);
});

app.delete('/api/cache', (req, res) => {
  const { key } = req.query;
  if (key) cache.delete(key);
  else cache.clear();
  res.json({ success: true });
});

// صفحة اختبار بسيطة
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>MediaFire Real Browser Resolver</title></head>
    <body>
      <h2>MediaFire Direct Link Extractor (Playwright)</h2>
      <input type="text" id="url" placeholder="MediaFire URL" style="width:400px"/>
      <button onclick="extract()">Extract</button>
      <pre id="result"></pre>
      <script>
        async function extract() {
          const url = document.getElementById('url').value;
          const res = await fetch('/api/extract', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({url}) });
          const data = await res.json();
          document.getElementById('result').innerText = JSON.stringify(data, null, 2);
        }
      </script>
    </body>
    </html>
  `);
});

// إيقاف نظيف عند الخروج
process.on('SIGINT', async () => {
  console.log('Shutting down gracefully...');
  await sessionManager.closeAll();
  process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`   Headless mode: ${BROWSER_HEADLESS}`);
  console.log(`   Proxy: ${PROXY_URL || 'none'}`);
});