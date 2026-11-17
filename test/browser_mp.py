import asyncio, json
from playwright.async_api import async_playwright
URL = 'http://localhost:8765/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=swiftshader','--enable-unsafe-swiftshader'])
        ctx = await b.new_context(viewport={'width':1366,'height':768})
        A = await ctx.new_page(); B = await ctx.new_page()
        logs = []
        for n,pg in (('A',A),('B',B)):
            pg.on('pageerror', lambda e, n=n: logs.append(f'{n} PAGEERROR: {e}'))
            pg.on('console', lambda m, n=n: logs.append(f'{n} {m.type}: {m.text}') if m.type=='error' and 'Failed to load' not in m.text else None)
        await A.goto(URL); await B.goto(URL); await A.wait_for_timeout(1500)
        await A.click('#m-mp'); await A.wait_for_timeout(500)
        await A.fill('#mp-name', 'Theo'); await A.click('#mp-host'); await A.wait_for_timeout(800)
        code = (await A.inner_text('.code')).strip()
        print('code', code)
        await B.click('#m-mp'); await B.wait_for_timeout(600)
        await B.screenshot(path='test/out/mp_join_list.png')
        await B.fill('#mp-name', 'Alex'); await B.fill('#mp-code', code); await B.click('#mp-join'); await B.wait_for_timeout(1200)
        # pick ShadowClan and ready
        await B.click('.clans .clan:nth-child(4)'); await B.wait_for_timeout(300); await B.click('#g-ready'); await B.wait_for_timeout(1200)
        await A.screenshot(path='test/out/mp_host.png')
        await A.click('#h-start'); await A.wait_for_timeout(3000)
        await A.screenshot(path='test/out/mp_A.png'); await B.screenshot(path='test/out/mp_B.png')
        # issue some orders from both sides
        for pg in (A, B):
            await pg.evaluate('''() => { const g = window.__app.game; const w = g.world; const ids = w.units.filter(u=>u.o===g.me&&u.t==='apprentice').map(u=>u.id);
               const r = w.ress.filter(r=>r.rt==='prey').sort((a,b)=>Math.hypot(a.x-w.get(w.players[g.me].campId).x,a.y-w.get(w.players[g.me].campId).y)-Math.hypot(b.x-w.get(w.players[g.me].campId).x,b.y-w.get(w.players[g.me].campId).y))[0];
               g.cmd({c:'gat', ids, t: r.id}); const n = w.blds.find(b=>b.o===g.me&&b.t==='nursery'); g.cmd({c:'trn', b:n.id, u:'apprentice', n:3}); }''')
        await A.wait_for_timeout(15000)
        res = []
        for pg in (A, B):
            res.append(await pg.evaluate('''() => { const g = window.__app.game; const ls = g.net.ls; return {me: g.me, tick: g.world.tick, hashes: Array.from(ls.myHashes.entries()), desync: ls.desync, delay: ls.delay, rtt: Math.round(ls.rtt), prey: g.world.players.map(p=>p.prey), pop: g.world.players.map(p=>p.pop)} }'''))
        print(json.dumps(res))
        ha = dict(map(tuple, res[0]['hashes'])); hb = dict(map(tuple, res[1]['hashes']))
        common = sorted(set(ha) & set(hb))
        print('common hash turns', common[-5:], 'all equal:', all(ha[t]==hb[t] for t in common))
        await A.screenshot(path='test/out/mp_A2.png')
        for l in logs[:20]: print(l)
        await b.close()
asyncio.run(main())
