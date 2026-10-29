// Run with Node and Playwright available; uses Edge and an isolated Firebase stub.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const firebaseStub = `
export const initializeApp = () => ({});
export const getAuth = () => ({ currentUser: { uid: 'test' } });
export const signInAnonymously = () => Promise.resolve();
export const getFirestore = () => ({});
export const doc = () => ({});
export function onSnapshot(ref, callback) {
    window.testSnapshot = data => {
        window.testData = structuredClone(data);
        callback({ exists: () => true, data: () => structuredClone(data) });
    };
    const today = new Date();
    const date = [today.getFullYear(), String(today.getMonth()+1).padStart(2,'0'), String(today.getDate()).padStart(2,'0')].join('-');
    window.testWrites = [];
    window.testSnapshot({ students: [{id:'a',name:'Ava',points:10},{id:'b',name:'Ben',points:20},{id:'c',name:'Cara',points:30}], bassBonusMultiplier:5, bassBonusDate:date });
}
export function setDoc(ref, data) {
    if (window.testFailSave) return Promise.reject(new Error('Simulated save rejection'));
    window.testWrites.push(structuredClone(data));
    window.testSnapshot(data);
    // A second server acknowledgement must not restart the count-up.
    setTimeout(() => window.testSnapshot(window.testData), 80);
    return Promise.resolve();
}`;

(async () => {
    const root = path.resolve(__dirname, '..');
    const server = http.createServer((req, res) => {
        const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
        if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
        res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : 'text/html');
        res.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1100, height: 850 } });
    const errors = [];
    try {
        await context.addInitScript(() => localStorage.setItem('timetable-hub:access:/:v1', 'unlocked'));
        await context.route('**/*', route => {
            const url = route.request().url();
            if (url.includes('cdn.tailwindcss.com') && process.env.LEADERBOARD_TAILWIND) return route.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(process.env.LEADERBOARD_TAILWIND, 'utf8') });
            if (url.includes('gstatic.com/firebasejs')) return route.fulfill({ contentType: 'text/javascript', body: firebaseStub });
            if (/firestore.googleapis|identitytoolkit.googleapis/.test(url)) throw new Error('Unexpected real Firebase access');
            if (url.startsWith(base) || url.includes('cdn.tailwindcss.com')) return route.continue();
            if (url.includes('confetti')) return route.fulfill({ contentType: 'text/javascript', body: 'window.confetti = () => {};' });
            return route.abort();
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base + '/leaderboard.html', { waitUntil: 'domcontentloaded' });
        console.log('Loaded isolated leaderboard');
        const row = id => page.locator(`.student-row[data-id="${id}"]`);
        const score = id => row(id).locator('.score-value');
        const open = async id => { await row(id).click(); await page.locator('#actionPopover').waitFor({ state: 'visible' }); };
        await row('a').waitFor();
        await open('a');
        await page.locator('#tokenCountInput').fill('6');
        assert.match(await page.locator('#tokenPreview').innerText(), /6 tokens × 5 = \+30 points/);
        await page.evaluate(() => {
            window.scoreSamples = [];
            window.sampleTimer = setInterval(() => {
                const rows = [...document.querySelectorAll('.student-row')];
                window.scoreSamples.push({ score: Number(rows.find(r => r.dataset.id === 'a')?.querySelector('.score-value').textContent), rank: rows.findIndex(r => r.dataset.id === 'a') + 1 });
            }, 10);
        });
        await page.locator('#redeemTokensButton').click();
        assert.equal(await page.evaluate(() => testWrites.length), 1);
        assert.equal(await page.evaluate(() => testWrites[0].students.find(s => s.id === 'a').points), 40);
        await page.waitForFunction(() => !document.querySelector('.points-counting'));
        assert.equal(await score('a').innerText(), '40');
        const samples = await page.evaluate(() => { clearInterval(sampleTimer); return scoreSamples; });
        assert(samples.some(s => s.score > 10 && s.score < 40), 'Intermediate scores appear');
        assert(samples.some(s => s.rank === 2), 'Student passes through the middle rank');
        assert(samples.some((s, i) => i > 0 && s.score === samples[i-1].score + 1), 'Scores tick up by one');
        assert.equal(await row('a').evaluate(el => el.parentElement.firstElementChild === el), true);
        console.log('PASS: token conversion, one final write, count-up, intermediate ranks and snapshot acknowledgement');

        await open('a');
        for (const invalid of ['0', '-2', '1.5', '9007199254740991']) {
            await page.locator('#tokenCountInput').fill(invalid);
            assert(await page.locator('#redeemTokensButton').isDisabled());
        }
        await page.evaluate(() => testSnapshot({ ...testData, bassBonusDate: '2000-01-01' }));
        await page.locator('#tokenCountInput').fill('3');
        assert(await page.locator('#redeemTokensButton').isDisabled());
        assert.match(await page.locator('#tokenPreview').innerText(), /Set and reveal/);
        await page.evaluate(() => closePopover());
        console.log('PASS: invalid counts and stale daily values cannot award tokens');

        await open('a');
        await page.getByRole('button', { name: '+10', exact: true }).click();
        await page.evaluate(() => { openPopover('a', document.querySelector('[data-id="a"]')); quickAddPoints(5); });
        await page.waitForFunction(() => !document.querySelector('.points-counting'));
        assert.equal(await score('a').innerText(), '55');
        assert.equal(await page.evaluate(() => testWrites.length), 3);
        await open('b');
        await page.locator('#popoverCustomPoints').fill('50');
        await page.getByRole('button', { name: 'Add custom points', exact: true }).click();
        await page.evaluate(() => { openPopover('b', document.querySelector('[data-id="b"]')); document.getElementById('popoverCustomPoints').value = '7'; applyCustomUpdate('deduct'); });
        assert.equal(await score('b').innerText(), '63');
        await page.waitForTimeout(250);
        assert.equal(await score('b').innerText(), '63');
        console.log('PASS: rapid repeated awards accumulate exactly; deductions interrupt count-up');

        await page.emulateMedia({ reducedMotion: 'reduce' });
        await open('c');
        await page.locator('#popoverCustomPoints').fill('100');
        await page.getByRole('button', { name: 'Set exact score', exact: true }).click();
        await page.waitForFunction(() => !document.querySelector('.points-counting'));
        assert.equal(await score('c').innerText(), '100');
        await page.locator('#awardSoundButton').click();
        assert.equal(await page.locator('#awardSoundButton').getAttribute('aria-pressed'), 'true');
        assert.equal(await page.evaluate(() => localStorage.getItem('leaderboard:award-muted')), 'true');
        console.log('PASS: exact-score increases, reduced motion and persistent mute');

        await page.setViewportSize({ width: 390, height: 600 });
        await open('b');
        await page.evaluate(() => testSnapshot({ ...testData, bassBonusDate: testData.bonusArmedDate }));
        await page.locator('#tokenCountInput').fill('3');
        await page.waitForTimeout(1700); // Let the earlier deduction announcement finish.
        const bounds = await page.locator('#actionPopover').boundingBox();
        if (process.env.LEADERBOARD_SCREENSHOT) await page.screenshot({ path: process.env.LEADERBOARD_SCREENSHOT });
        assert(bounds.y >= 0 && bounds.y + bounds.height <= 600 && bounds.x >= 0 && bounds.x + bounds.width <= 390, JSON.stringify(bounds));
        await page.locator('#tokenCountInput').press('Enter');
        await page.waitForFunction(() => !document.querySelector('.points-counting'));
        assert.equal(await score('b').innerText(), '78');
        await page.evaluate(() => { testFailSave = true; openPopover('b', document.querySelector('[data-id="b"]')); quickAddPoints(5); });
        await page.locator('#saveError').waitFor({ state: 'visible' });
        assert.equal(await score('b').innerText(), '78');
        await page.evaluate(() => { testFailSave = false; });
        console.log('PASS: mobile popover fits, Enter redeems tokens, failed save is surfaced and reverted');

        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.evaluate(() => { openPopover('a', document.querySelector('[data-id="a"]')); quickAddPoints(100000); });
        await page.waitForFunction(() => !document.querySelector('.points-counting'), { timeout: 8000 });
        assert.equal(await score('a').innerText(), '100055');
        await page.evaluate(() => { openPopover('b', document.querySelector('[data-id="b"]')); quickAddPoints(50); confirmReset(); });
        await page.waitForTimeout(200);
        assert.equal(await page.locator('.student-row').count(), 0);
        assert.equal(await page.evaluate(() => testData.students.length), 0);
        assert.deepEqual(errors, []);
        console.log('PASS: large awards finish promptly and reset cancels presentation; no browser errors');
    } finally {
        await browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
