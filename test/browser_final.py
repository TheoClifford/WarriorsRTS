import asyncio, json
from playwright.async_api import async_playwright
URL = 'http://localhost:8765/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=swiftshader','--enable-unsafe-swiftshader'])
        pg = await b.new_page(viewport={'width':1366,'height':768})
        logs = []
        pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type in ('error',) and 'Failed to load resource' not in m.text else None)
        pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(2000)
        await pg.click('#m-sp'); await pg.wait_for_timeout(300)
        await pg.select_option('#o-strat', 'rush'); await pg.click('.clans .clan:nth-child(2)'); await pg.click('#o-go'); await pg.wait_for_timeout(1500)
        # play: send apprentices to the nearest prey, queue apprentices, then fast-forward
        await pg.evaluate('''() => { const g = window.__app.game; const w = g.world; const c = w.get(w.players[0].campId);
          const ids = w.units.filter(u=>u.o===0&&u.t==='apprentice').map(u=>u.id);
          const r = w.ress.filter(r=>r.rt==='prey'&&r.home===0).sort((a,b)=>Math.hypot(a.x-c.x,a.y-c.y)-Math.hypot(b.x-c.x,b.y-c.y))[0];
          g.cmd({c:'gat', ids, t:r.id}); const n = w.blds.find(b=>b.o===0&&b.t==='nursery'); g.cmd({c:'trn', b:n.id, u:'apprentice', n:4}); g.speed = 4; }''')
        await pg.wait_for_timeout(45000)
        # find a fight to look at, else the camp
        await pg.evaluate('''() => { const g = window.__app.game; const w = g.world; const f = w.units.filter(u=>!u.dead&&!u.hide&&u.o>=0&&w.tick-u.lastFight<80);
          const t = f.length ? f[0] : w.get(w.players[0].campId); g.renderer.centerOn(t.x, t.y); g.speed = 1;
          const sel = w.units.filter(u=>u.o===0 && u.t==='apprentice').slice(0,1).map(u=>u.id); g.sel = new Set(sel); g.selChanged(); }''')
        await pg.wait_for_timeout(1500)
        await pg.screenshot(path='test/out/f1_play.png')
        info = await pg.evaluate('() => { const w = window.__app.game.world; return {tick: w.tick, p: w.players.map(p=>({age:p.age,pop:p.pop,prey:p.prey,lives:p.lives})), sprites: window.__app.game.renderer.sprites.map.size} }')
        print(json.dumps(info))
        await pg.keyboard.press('F2'); await pg.wait_for_timeout(500); await pg.screenshot(path='test/out/f2_tree.png'); await pg.keyboard.press('Escape')
        await pg.keyboard.press('F1'); await pg.wait_for_timeout(500); await pg.screenshot(path='test/out/f3_help.png'); await pg.keyboard.press('Escape')
        await pg.evaluate("() => window.__app.game.cmd({c:'resign'})"); await pg.wait_for_timeout(4500)
        await pg.screenshot(path='test/out/f4_end.png')
        for l in logs[:20]: print(l)
        await b.close()
asyncio.run(main())
