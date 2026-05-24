const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// كاش لتخزين النتائج مؤقتًا (لمنع الطلبات المتكررة)
const cache = new Map();
const CACHE_DURATION = 30 * 60 * 1000; // 30 دقيقة

/**
 * تنظيف الكاش القديم
 */
function cleanupCache() {
    const now = Date.now();
    for (const [key, value] of cache.entries()) {
        if (now - value.timestamp > CACHE_DURATION) {
            cache.delete(key);
        }
    }
}

// تنظيف الكاش كل 5 دقائق
setInterval(cleanupCache, 5 * 60 * 1000);

/**
 * استخراج الرابط المباشر من MediaFire
 */
async function extractDirectLink(mediafireUrl) {
    try {
        console.log(`🔍 جاري تحليل الرابط: ${mediafireUrl}`);
        
        const { data: html } = await axios.get(mediafireUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Upgrade-Insecure-Requests': '1'
            },
            timeout: 10000
        });
        
        const $ = cheerio.load(html);
        
        // الطريقة 1: البحث في زر التحميل الرئيسي
        let directLink = $('#downloadButton').attr('href');
        
        // الطريقة 2: البحث في عناصر التحميل الأخرى
        if (!directLink) {
            directLink = $('a.downloadButton').attr('href') ||
                        $('a#download_link').attr('href') ||
                        $('a[aria-label="Download file"]').attr('href');
        }
        
        // الطريقة 3: البحث في البيانات البرمجية
        if (!directLink) {
            // البحث في النصوص البرمجية للرابط المباشر
            const scriptPatterns = [
                /"download_link"\s*:\s*"([^"]+)"/i,
                /downloadUrl\s*:\s*['"]([^'"]+)['"]/i,
                /"href"\s*:\s*"([^"]+)"\s*,\s*"label"\s*:\s*"Download Now"/i,
                /https:\/\/download\d+\.mediafire\.com\/[a-z0-9]+\/[a-z0-9]+\/[^'"]+/i
            ];
            
            $('script').each((index, script) => {
                const scriptContent = $(script).html();
                if (scriptContent) {
                    for (const pattern of scriptPatterns) {
                        const match = scriptContent.match(pattern);
                        if (match && match[1]) {
                            directLink = match[1];
                            break;
                        }
                    }
                }
            });
        }
        
        // الطريقة 4: البحث في جميع الروابط التي تحتوي على download
        if (!directLink) {
            $('a[href*="download"]').each((index, element) => {
                const href = $(element).attr('href');
                if (href && href.includes('mediafire.com')) {
                    directLink = href;
                    return false;
                }
            });
        }
        
        // معالجة الرابط
        if (directLink) {
            // إصلاح الروابط النسبية
            if (directLink.startsWith('//')) {
                directLink = 'https:' + directLink;
            } else if (directLink.startsWith('/')) {
                directLink = 'https://www.mediafire.com' + directLink;
            }
            
            // التأكد من أن الرابط هو رابط تنزيل مباشر
            if (!directLink.includes('download') && directLink.includes('mediafire.com/file/')) {
                // تحويل رابط الملف إلى رابط تنزيل
                const fileIdMatch = directLink.match(/mediafire\.com\/file\/([a-z0-9]+)/i);
                if (fileIdMatch) {
                    directLink = `https://download${Math.floor(Math.random() * 3) + 1}.mediafire.com/${fileIdMatch[1]}`;
                }
            }
            
            console.log(`✅ تم استخراج الرابط المباشر: ${directLink}`);
            
            // التحقق من أن الرابط يعمل
            try {
                const response = await axios.head(directLink, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    },
                    timeout: 5000
                });
                
                if (response.status === 200 || response.status === 302) {
                    return {
                        success: true,
                        directLink: directLink,
                        contentType: response.headers['content-type'] || 'application/octet-stream',
                        contentLength: response.headers['content-length'],
                        timestamp: Date.now()
                    };
                }
            } catch (headError) {
                console.log('⚠️ تحذير: لا يمكن التحقق من الرابط، ولكن سيتم استخدامه:', headError.message);
            }
            
            return {
                success: true,
                directLink: directLink,
                timestamp: Date.now()
            };
        } else {
            console.log('❌ لم يتم العثور على رابط مباشر');
            return {
                success: false,
                error: 'لم يتم العثور على رابط مباشر في الصفحة'
            };
        }
        
    } catch (error) {
        console.error(`❌ خطأ في استخراج الرابط: ${error.message}`);
        return {
            success: false,
            error: `خطأ في استخراج الرابط: ${error.message}`
        };
    }
}

/**
 * نقطة النهاية لاستخراج الروابط
 */
app.post('/api/extract', async (req, res) => {
    try {
        const { url, cacheKey } = req.body;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'يرجى إرسال رابط MediaFire'
            });
        }
        
        if (!url.includes('mediafire.com')) {
            return res.status(400).json({
                success: false,
                error: 'الرابط يجب أن يكون من موقع MediaFire'
            });
        }
        
        // التحقق من الكاش أولاً
        const cacheKeyToUse = cacheKey || url;
        const cachedResult = cache.get(cacheKeyToUse);
        
        if (cachedResult && (Date.now() - cachedResult.timestamp < CACHE_DURATION)) {
            console.log('📦 استرجاع من الكاش:', cacheKeyToUse);
            return res.json({
                ...cachedResult,
                cached: true
            });
        }
        
        // استخراج الرابط
        const result = await extractDirectLink(url);
        
        // تخزين في الكاش
        if (result.success) {
            cache.set(cacheKeyToUse, result);
        }
        
        res.json(result);
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * نقطة النهاية GET
 */
app.get('/api/extract', async (req, res) => {
    try {
        const { url, cacheKey } = req.query;
        
        if (!url) {
            return res.status(400).json({
                success: false,
                error: 'يرجى إضافة رابط MediaFire كمعامل url'
            });
        }
        
        if (!url.includes('mediafire.com')) {
            return res.status(400).json({
                success: false,
                error: 'الرابط يجب أن يكون من موقع MediaFire'
            });
        }
        
        // التحقق من الكاش أولاً
        const cacheKeyToUse = cacheKey || url;
        const cachedResult = cache.get(cacheKeyToUse);
        
        if (cachedResult && (Date.now() - cachedResult.timestamp < CACHE_DURATION)) {
            console.log('📦 استرجاع من الكاش:', cacheKeyToUse);
            return res.json({
                ...cachedResult,
                cached: true
            });
        }
        
        // استخراج الرابط
        const result = await extractDirectLink(url);
        
        // تخزين في الكاش
        if (result.success) {
            cache.set(cacheKeyToUse, result);
        }
        
        res.json(result);
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * نقطة نهاية للتحقق من حالة السيرفر
 */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        cacheSize: cache.size
    });
});

/**
 * نقطة نهاية لمسح الكاش
 */
app.delete('/api/cache', (req, res) => {
    const { key } = req.query;
    
    if (key) {
        cache.delete(key);
        res.json({
            success: true,
            message: `تم حذف المفتاح ${key} من الكاش`
        });
    } else {
        cache.clear();
        res.json({
            success: true,
            message: 'تم مسح الكاش بالكامل'
        });
    }
});

/**
 * صفحة HTML للاختبار
 */
app.get('/', (req, res) => {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>MediaFire Direct Link Extractor API</title>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 800px;
                margin: 0 auto;
                padding: 20px;
                background-color: #f5f5f5;
            }
            .container {
                background: white;
                border-radius: 10px;
                padding: 30px;
                box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            h1 {
                color: #2c3e50;
                border-bottom: 2px solid #3498db;
                padding-bottom: 10px;
            }
            .endpoint {
                background: #f8f9fa;
                border-left: 4px solid #3498db;
                padding: 15px;
                margin: 20px 0;
                border-radius: 4px;
            }
            code {
                background: #2c3e50;
                color: #ecf0f1;
                padding: 2px 6px;
                border-radius: 4px;
                font-family: 'Courier New', monospace;
            }
            .test-form {
                margin-top: 30px;
                padding: 20px;
                background: #f8f9fa;
                border-radius: 8px;
            }
            input[type="text"] {
                width: 100%;
                padding: 12px;
                margin: 10px 0;
                border: 1px solid #ddd;
                border-radius: 4px;
                box-sizing: border-box;
                font-size: 16px;
            }
            button {
                background: #3498db;
                color: white;
                border: none;
                padding: 12px 24px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 16px;
                transition: background 0.3s;
            }
            button:hover {
                background: #2980b9;
            }
            .result {
                margin-top: 20px;
                padding: 15px;
                border-radius: 4px;
                display: none;
            }
            .success {
                background: #d4edda;
                border: 1px solid #c3e6cb;
                color: #155724;
            }
            .error {
                background: #f8d7da;
                border: 1px solid #f5c6cb;
                color: #721c24;
            }
            .loading {
                background: #d1ecf1;
                border: 1px solid #bee5eb;
                color: #0c5460;
            }
            .api-info {
                background: #e8f4f8;
                padding: 15px;
                border-radius: 8px;
                margin: 20px 0;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🌐 MediaFire Direct Link Extractor API</h1>
            
            <div class="api-info">
                <p><strong>📊 حالة السيرفر:</strong> <span id="status">جاري التحقق...</span></p>
                <p><strong>📦 حجم الكاش:</strong> <span id="cacheSize">--</span> عنصر</p>
            </div>
            
            <h2>🎯 نقاط النهاية المتاحة:</h2>
            
            <div class="endpoint">
                <h3>POST /api/extract</h3>
                <p>استخراج رابط مباشر من MediaFire</p>
                <code>{
    "url": "https://www.mediafire.com/file/..."
}</code>
            </div>
            
            <div class="endpoint">
                <h3>GET /api/extract?url=...</h3>
                <p>استخراج رابط مباشر عبر GET</p>
            </div>
            
            <div class="endpoint">
                <h3>GET /api/health</h3>
                <p>فحص حالة السيرفر</p>
            </div>
            
            <div class="test-form">
                <h2>🧪 اختبار API</h2>
                <input type="text" id="testUrl" placeholder="أدخل رابط MediaFire هنا..." value="https://www.mediafire.com/file/j0y5aiqzukgp3zw/One+Piece+001+720p.mp4">
                <button onclick="testExtract()">اختبار الاستخراج</button>
                
                <div id="testResult" class="result"></div>
            </div>
            
            <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                <p><strong>📝 ملاحظات:</strong></p>
                <ul>
                    <li>السيرفر يستخدم كاش لتخزين النتائج لمدة 30 دقيقة</li>
                    <li>يدعم الطلبات عبر CORS</li>
                    <li>يعمل مع معظم روابط MediaFire</li>
                </ul>
            </div>
        </div>
        
        <script>
            // التحقق من حالة السيرفر
            async function checkStatus() {
                try {
                    const response = await fetch('/api/health');
                    const data = await response.json();
                    document.getElementById('status').textContent = 'يعمل ✅';
                    document.getElementById('cacheSize').textContent = data.cacheSize;
                } catch (error) {
                    document.getElementById('status').textContent = 'غير متصل ❌';
                }
            }
            
            // اختبار الاستخراج
            async function testExtract() {
                const url = document.getElementById('testUrl').value.trim();
                const resultDiv = document.getElementById('testResult');
                
                if (!url) {
                    showResult('يرجى إدخال رابط', 'error');
                    return;
                }
                
                if (!url.includes('mediafire.com')) {
                    showResult('الرابط يجب أن يكون من موقع MediaFire', 'error');
                    return;
                }
                
                showResult('جاري استخراج الرابط المباشر...', 'loading');
                
                try {
                    const response = await fetch('/api/extract', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ url: url })
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        const html = '<h3 style="color: #27ae60;">✅ تم الاستخراج بنجاح</h3>' +
                                   '<p><strong>الرابط المباشر:</strong></p>' +
                                   '<div style="background: white; padding: 10px; border-radius: 4px; margin: 10px 0; word-break: break-all;">' + 
                                   escapeHtml(data.directLink) + 
                                   '</div>' +
                                   (data.cached ? '<p><em>📦 تم استرجاعه من الكاش</em></p>' : '') +
                                   '<div style="margin-top: 10px;">' +
                                   '<button onclick="copyToClipboard(\\'' + escapeSingleQuotes(data.directLink) + '\\')" style="margin-right: 10px;">نسخ الرابط</button>' +
                                   '<button onclick="window.open(\\'' + escapeSingleQuotes(data.directLink) + '\\', \\'_blank\\')">فتح الرابط</button>' +
                                   '</div>';
                        showResult(html, 'success');
                    } else {
                        showResult('<h3 style="color: #e74c3c;">❌ خطأ</h3><p>' + escapeHtml(data.error) + '</p>', 'error');
                    }
                } catch (error) {
                    showResult('<h3 style="color: #e74c3c;">❌ خطأ في الاتصال</h3><p>' + escapeHtml(error.message) + '</p>', 'error');
                }
            }
            
            function showResult(content, type) {
                const resultDiv = document.getElementById('testResult');
                resultDiv.innerHTML = content;
                resultDiv.className = 'result ' + type;
                resultDiv.style.display = 'block';
            }
            
            function copyToClipboard(text) {
                navigator.clipboard.writeText(text).then(() => {
                    alert('✅ تم نسخ الرابط إلى الحافظة');
                }).catch(err => {
                    alert('❌ فشل نسخ الرابط: ' + err);
                });
            }
            
            function escapeHtml(text) {
                const div = document.createElement('div');
                div.textContent = text;
                return div.innerHTML;
            }
            
            function escapeSingleQuotes(text) {
                return text.replace(/'/g, "\\'");
            }
            
            // التحقق من الحالة عند التحميل
            checkStatus();
            // تحديث حالة الكاش كل 30 ثانية
            setInterval(checkStatus, 30000);
        </script>
    </body>
    </html>
    `;
    
    res.send(html);
});

// معالجة الأخطاء
app.use((err, req, res, next) => {
    console.error('❌ خطأ في السيرفر:', err.stack);
    res.status(500).json({
        success: false,
        error: 'خطأ داخلي في السيرفر'
    });
});

// تشغيل السيرفر
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 السيرفر يعمل على http://localhost:${PORT}`);
    console.log(`📌 نقطة النهاية: POST /api/extract`);
    console.log(`📌 نقطة النهاية: GET /api/extract?url=رابط_الملف`);
    console.log(`📌 صفحة الاختبار: http://localhost:${PORT}/`);

});
