import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 400, height: 850 });

const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(err.stack || err.message));

await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2', timeout: 20000 });
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => window.__OS__?.openApp('wechat'));
await new Promise((r) => setTimeout(r, 1500));

// Open chat
await page.evaluate(() => {
  const triggers = Array.from(document.querySelectorAll('[data-trigger="chat.open"]'));
  for (const t of triggers) {
    if ((t.textContent || '').trim().length > 0) { t.click(); break; }
  }
});
await new Promise((r) => setTimeout(r, 1500));

// Open + panel via svg parent
const plusRes = await page.evaluate(() => {
  const svgs = Array.from(document.querySelectorAll('svg'));
  // Plus icon is lucide-circle-plus
  const plusSvg = svgs.find(s =>
    s.classList.contains('w-7') && s.classList.contains('h-7') &&
    (s.getAttribute('class') || '').includes('circle-plus')
  );
  if (!plusSvg) return 'no-svg';
  const btn = plusSvg.closest('button');
  if (!btn) return 'no-btn';
  btn.click();
  return 'ok';
});
console.log('0. Plus:', plusRes);
await new Promise((r) => setTimeout(r, 1000));

// Click transfer
await page.evaluate(() => {
  const el = document.querySelector('[data-trigger="chat.transfer.open"]');
  if (el) el.click();
});
await new Promise((r) => setTimeout(r, 1500));

// On TransferPage: input amount via digit buttons
const amountTyped = await page.evaluate(() => {
  // Type "1" "0" "0"
  const numBtns = Array.from(document.querySelectorAll('button'));
  const findNum = (n) => numBtns.find(b => (b.textContent || '').trim() === String(n));
  ['1','0','0'].forEach(n => findNum(n)?.click());
  return true;
});
console.log('1. Amount typed:', amountTyped);
await new Promise((r) => setTimeout(r, 500));

// Click confirm-transfer button (chat.transfer.confirm.open) to go to confirm page
const confirmNav = await page.evaluate(() => {
  const el = document.querySelector('[data-trigger="chat.transfer.confirm.open"]');
  if (el) { el.click(); return true; }
  return false;
});
console.log('2. Click confirm-transfer:', confirmNav);
await new Promise((r) => setTimeout(r, 1500));

// On TransferConfirmPage: click 确认转账 to open password pad
await page.evaluate(() => {
  const el = document.querySelector('[data-action="wechat.transfer.confirm"]');
  if (el) el.click();
});
await new Promise((r) => setTimeout(r, 500));

// Type 6-digit password
await page.evaluate(() => {
  for (let n = 1; n <= 6; n++) {
    const el = document.querySelector(`[data-action="wechat.pay.num.${n}"]`);
    if (el) el.click();
  }
});
console.log('3. Password entered');

// Wait for setTimeout(1000) in onPasswordComplete to fire
await new Promise((r) => setTimeout(r, 2500));

// Check current state
const url = await page.evaluate(() => location.pathname + location.hash);
const visibleText = await page.evaluate(() => (document.getElementById('root')?.textContent || '').replace(/\s+/g, ' ').slice(0, 250));
console.log('\n=== After transfer URL ===', url);
console.log('=== Visible (250 chars) ===\n', visibleText);
console.log('\n=== PAGE ERRORS ===');
pageErrors.slice(0, 5).forEach((e) => console.log(e));

await browser.close();
