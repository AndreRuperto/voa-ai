import sys
from playwright.sync_api import sync_playwright
out = sys.argv[1]
casos = [("inicio","d",1600,900),("confirmacao","d",1600,900),("status","d",1600,900),("status-atraso","d",1600,900),
         ("status-cancelado","d",1600,900),("meus-voos","d",1600,900),("status","m",375,812),("inicio","m",375,812)]
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle","--use-angle=swiftshader","--enable-unsafe-swiftshader"])
    for tela, tipo, w, h in casos:
        pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=1, reduced_motion="reduce")
        pg.goto(f"http://localhost:8741/v2/#{tela}"); pg.wait_for_timeout(3500)
        pg.screenshot(path=f"{out}/v2-{tela}-{tipo}.png"); pg.close()
    b.close()
