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
        await pg.goto(URL); await pg.wait_for_timeout(2000)
        await pg.click('#m-watch'); await pg.wait_for_timeout(300); await pg.click('#o-go'); await pg.wait_for_timeout(1000)
        await pg.evaluate('''() => { const g = window.__app.game; g.speed = 4; const r = g.renderer; const d = r.draw.bind(r);
          window.__ft = []; r.draw = (...a) => { const t = performance.now(); d(...a); window.__ft.push(performance.now()-t); }; }''')
        shots = 0
        for i in range(60):
            await pg.wait_for_timeout(5000)
            st = await pg.evaluate('''() => { const g = window.__app.game; const w = g.world; const ft = window.__ft.splice(0); ft.sort((a,b)=>a-b);
              // follow the action
              const f = w.units.filter(u=>!u.dead&&!u.hide&&u.o>=0&&w.tick-u.lastFight<60);
              if (f.length) g.renderer.centerOn(f[0].x, f[0].y);
              return {tick: w.tick, season: w.season, frozen: w.frozen, over: w.over, units: w.units.length, monsters: w.monsters.length,
                ftMed: ft[ft.length>>1]|0, ftP95: ft[Math.floor(ft.length*0.95)]|0, frames: ft.length, sprites: g.renderer.sprites.map.size, fighting: f.length,
                p: w.players.map(p=>[p.age,p.pop,p.lives]) } }''')
            print(json.dumps(st))
            if st['fighting'] and shots < 3: await pg.screenshot(path=f'test/out/w_fight{shots}.png'); shots += 1
            if st['season']==3 and not st.get('snowshot'):
                await pg.screenshot(path='test/out/w_snow.png')
            if st['over']: break
        await pg.screenshot(path='test/out/w_end.png')
        for l in logs[:20]: print(l)
        await b.close()
asyncio.run(main())
