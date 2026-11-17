import asyncio, json
from playwright.async_api import async_playwright
URL = 'http://localhost:8765/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=swiftshader','--enable-unsafe-swiftshader'])
        pg = await b.new_page(viewport={'width':1366,'height':768})
        logs = []
        pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}') if m.type in ('error','warning') and 'Failed to load resource' not in m.text else None)
        pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        await pg.goto(URL); await pg.wait_for_timeout(2500)
        await pg.click('#m-sp'); await pg.wait_for_timeout(300); await pg.click('#o-go'); await pg.wait_for_timeout(2500)
        # screen positions of my apprentices
        pos = await pg.evaluate('''() => { const g = window.__app.game; const w = g.world;
          return w.units.filter(u=>u.o===0 && u.t==='apprentice').map(u=>g.renderer.toScreen(u.x,u.y)); }''')
        xs=[p[0] for p in pos]; ys=[p[1] for p in pos]
        await pg.mouse.move(min(xs)-25, min(ys)-40); await pg.mouse.down(); await pg.mouse.move(max(xs)+25, max(ys)+15, steps=5); await pg.mouse.up()
        await pg.wait_for_timeout(400)
        await pg.screenshot(path='test/out/s4_select.png')
        # hover a build button for tooltip
        await pg.hover('#cmds .cmd:nth-child(3)'); await pg.wait_for_timeout(300)
        await pg.screenshot(path='test/out/s5_tooltip.png')
        # place a den with Q at a spot near camp
        info = await pg.evaluate('''() => { const g = window.__app.game; const w = g.world; const c = w.get(w.players[0].campId); return g.renderer.toScreen(c.x, c.y); }''')
        await pg.keyboard.press('q'); await pg.mouse.move(info[0]+220, info[1]+40); await pg.wait_for_timeout(300)
        await pg.screenshot(path='test/out/s6_place.png')
        await pg.mouse.click(info[0]+220, info[1]+40); await pg.wait_for_timeout(400)
        # select nursery and queue apprentices
        n = await pg.evaluate('''() => { const g = window.__app.game; const w = g.world; const n = w.blds.find(b=>b.o===0&&b.t==='nursery'); return g.renderer.toScreen(n.x, n.y); }''')
        await pg.mouse.click(n[0], n[1]); await pg.wait_for_timeout(300)
        await pg.keyboard.press('q'); await pg.keyboard.press('q'); await pg.wait_for_timeout(400)
        await pg.screenshot(path='test/out/s7_nursery.png')
        # right-click gather: select apprentices again then right-click a moss bed
        st = await pg.evaluate('''() => { const g = window.__app.game; const w = g.world;
          return {tick: w.tick, q: w.blds.find(b=>b.o===0&&b.t==='nursery').q.length, dens: w.blds.filter(b=>b.o===0&&b.t==='den').length, prey: w.players[0].prey, moss: w.players[0].moss,
            orders: w.units.filter(u=>u.o===0&&u.t==='apprentice').map(u=>u.ord.length?u.ord[0].o:'-').join(',') } }''')
        print(json.dumps(st))
        for l in logs[:20]: print(l)
        await b.close()
asyncio.run(main())
