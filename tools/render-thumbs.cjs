// Sparar kartornas miniatyrbilder i img/maps/<id>.jpg.
// Kör från projektmappen medan en webbserver är igång:
//   python3 -m http.server 8080
//   node tools/render-thumbs.cjs
// Kräver Playwright (npm i -D playwright, eller en global installation).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto((process.env.BASE || 'http://localhost:8080') + '/tools/thumbs.html');
  await page.waitForFunction(() => window.thumbsReady, null, { timeout: 300000 });
  const ids = await page.evaluate(() => window.thumbIds);
  const out = path.join(__dirname, '..', 'img', 'maps');
  fs.mkdirSync(out, { recursive: true });
  for (const id of ids) {
    const url = await page.evaluate((i) => window.renderThumb(i), id);
    fs.writeFileSync(path.join(out, id + '.jpg'), Buffer.from(url.split(',')[1], 'base64'));
    console.log('saved', id);
  }
  if (errors.length) console.log('errors', errors);
  await browser.close();
})();
