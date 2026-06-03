FROM node:18-slim

# تثبيت تبعيات Playwright (Chromium) والمكتبات المفقودة
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# تعيين متغيرات البيئة لتشغيل Playwright بدون واجهة رسومية
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# نسخ ملفات المشروع
COPY package*.json ./
COPY .npmrc ./

# تثبيت الحزم (بدون package-lock)
RUN npm install --no-package-lock

# تثبيت متصفحات Playwright
RUN npx playwright install chromium

# نسخ باقي الملفات
COPY . .

EXPOSE 8080

CMD ["node", "server.js"]
