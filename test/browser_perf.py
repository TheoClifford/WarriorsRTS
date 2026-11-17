# Smoke + frame-time test for the renderer: skirmish, pan across the map, read frame times, check for errors.
import asyncio, json
from playwright.async_api import async_playwright
URL = 'http://localhost:8765/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=swiftshader', '--enable-unsafe-swiftshader'])
        pg = await b.new_page(viewport={'width': 1366, 'height': 768})
        logs = []
        pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type in ('error', 'warning') and 'Failed to load resource' not in m.text else None)
        pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(1500)
        await pg.click('#m-sp'); await pg.wait_for_timeout(300)
        await pg.click('.clans .clan:nth-child(4)'); await pg.click('#o-go'); await pg.wait_for_timeout(2500)
        res = await pg.evaluate('''() => new Promise(done => {
          const g = window.__app.game, R = g.renderer, w = g.world; g.speed = 2;
          const N = w.map.n * 1024; const pts = [[0.2,0.2],[0.8,0.2],[0.8,0.8],[0.2,0.8],[0.5,0.5]];
          const times = []; let last = performance.now(), k = 0, t0 = last;
          function f(now) { times.push(now - last); last = now;
            if (times.length % 40 === 0 && k < pts.length) { R.centerOn(pts[k][0]*N, pts[k][1]*N); k++; }
            if (now - t0 < 9000) requestAnimationFrame(f); else {
              times.sort((a,b)=>a-b); const q = p => times[Math.floor(times.length*p)];
              done({frames: times.length, p50: q(0.5).toFixed(1), p90: q(0.9).toFixed(1), p99: q(0.99).toFixed(1), max: times[times.length-1].toFixed(1), tick: w.tick, sprites: R.sprites.map.size}); } }
          requestAnimationFrame(f); })''')
        print(json.dumps(res))
        await pg.screenshot(path='test/out/perf_end.png')
        await pg.evaluate("() => { const g = window.__app.game, w = g.world, c = w.get(w.players[0].campId); g.renderer.centerOn(c.x + 3000, c.y + 2000); }")
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path='test/out/perf_camp.png')
        for l in logs[:20]: print(l)
        await b.close()
asyncio.run(main())
