// Run with Node and Playwright available (uses installed Microsoft Edge).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { chromium } = require('playwright');

(async () => {
    const root = path.resolve(__dirname, '..');
    const pages = fs.readdirSync(root, { recursive: true }).filter(file => file.endsWith('.html') && file !== 'password.html');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'timetable-lock-'));
    let appExecutions = 0;
    const server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/timetable-hub/execution-probe') {
            appExecutions++;
            res.writeHead(204).end();
            return;
        }
        const relative = decodeURIComponent(url.pathname).replace(/^\/timetable-hub\//, '');
        const file = path.resolve(root, relative || 'index.html');
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            res.writeHead(404).end();
            return;
        }
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
        let source = fs.readFileSync(file, 'utf8');
        if (file.endsWith('.html') && !file.endsWith('password.html')) {
            // A real script immediately after the guard must remain inert.
            source = source.replace(/(<script src="[^"]*site-access\.js"><\/script>)/,
                '$1<script>fetch("/timetable-hub/execution-probe")</script>');
        }
        res.end(source);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}/timetable-hub/`;
    const remoteRequests = [];
    let context;
    let browser;
    async function blockRemote(target) {
        await target.route('**/*', route => {
            if (!route.request().url().startsWith(base)) {
                remoteRequests.push(route.request().url());
                return route.abort();
            }
            return route.continue();
        });
    }
    try {
        context = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: true });
        await blockRemote(context);
        let page = await context.newPage();
        for (const file of pages) {
            await page.goto(base + file.replaceAll('\\', '/'));
            await page.waitForURL('**/password.html?*');
            await page.locator('#password').waitFor();
            assert.equal(await page.title(), 'Enter password');
        }
        assert.equal(appExecutions, 0, 'App scripts must remain inert before unlocking');
        // Browsers may speculatively preload static assets before the guard runs.
        assert.deepEqual(remoteRequests.filter(url => /firestore.googleapis.com|identitytoolkit.googleapis.com/.test(url)), []);
        console.log(`PASS: all ${pages.length} direct page URLs locked, with app scripts inactive and no database requests`);

        const destination = base + 'index.html?test=1#week';
        await page.goto(destination);
        await page.waitForURL('**/password.html?*');
        await page.locator('#password').fill('9999');
        await page.locator('button').click();
        assert.equal(await page.locator('#password-error').textContent(), 'Incorrect password. Try again.');
        assert.equal(await page.evaluate(() => localStorage.length), 0);
        await page.locator('#password').fill('0123');
        await page.locator('button').click();
        await page.waitForURL(destination);
        assert.equal(await page.locator('html').getAttribute('data-site-unlocked'), '');
        assert.equal(await page.locator('body').isVisible(), true);
        console.log('PASS: incorrect password rejected; correct password restores original URL and shows page');

        await context.close();
        context = await chromium.launchPersistentContext(profile, { channel: 'msedge', headless: true });
        await blockRemote(context);
        page = await context.newPage();
        const nested = base + 'interactive_apps/maths/types_of_triangles.html';
        await page.goto(nested);
        assert.equal(page.url(), nested);
        assert.equal(await page.locator('body').isVisible(), true);
        await page.reload();
        assert.equal(page.url(), nested);
        console.log('PASS: access persists after browser restart, across pages and reloads');

        await page.goto(base + 'password.html?return=https://example.com/');
        await page.waitForURL(base + 'index.html');
        await page.goto(base + 'password.html?return=/another-project/');
        await page.waitForURL(base + 'index.html');
        console.log('PASS: return URLs cannot redirect outside this project');

        await page.evaluate(() => localStorage.clear());
        await page.goto(nested);
        await page.waitForURL('**/password.html?*');
        await page.setViewportSize({ width: 375, height: 667 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: path.join(os.tmpdir(), 'timetable-password.png') });
        console.log('PASS: clearing site data relocks; password screen fits mobile viewport');

        browser = await chromium.launch({ channel: 'msedge', headless: true });
        const fresh = await browser.newContext();
        await blockRemote(fresh);
        const freshPage = await fresh.newPage();
        await freshPage.goto(base + 'home.html');
        await freshPage.waitForURL('**/password.html?*');
        await freshPage.addInitScript(() => {
            Storage.prototype.setItem = () => { throw new Error('Storage blocked'); };
        });
        await freshPage.reload();
        await freshPage.locator('#password').fill('0123');
        await freshPage.locator('button').click();
        assert.match(await freshPage.locator('#password-error').textContent(), /Allow this site/);
        console.log('PASS: fresh browser is locked; blocked storage gives an actionable error');

        const noJS = await browser.newContext({ javaScriptEnabled: false });
        await blockRemote(noJS);
        const noJSPage = await noJS.newPage();
        await noJSPage.goto(base + 'index.html');
        assert.equal(await noJSPage.locator('body').isVisible(), false);
        console.log('PASS: disabling JavaScript does not expose the app UI');
    } finally {
        if (context) await context.close();
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(profile, { recursive: true, force: true });
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
