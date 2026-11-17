import asyncio, sys, json
from playwright.async_api import async_playwright
URL = 'http://localhost:8765/index.html'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required'])
        pg = await b.new_page(viewport={'width':1366,'height':768})
        logs = []
        pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        await pg.goto(URL)
        await pg.wait_for_timeout(4000)
        await pg.screenshot(path='test/out/s1_menu.png')
        await pg.click('#m-sp'); await pg.wait_for_timeout(500)
        await pg.screenshot(path='test/out/s2_setup.png')
        await pg.click('#o-go'); await pg.wait_for_timeout(5000)
        await pg.screenshot(path='test/out/s3_game.png')
        for l in logs[:30]: print(l)
        await b.close()
asyncio.run(main())
