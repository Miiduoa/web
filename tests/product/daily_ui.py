"""Local HTTPS UI regression with production CSP and no external services."""
import functools, http.server, json, ssl, subprocess, tempfile, threading, time, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'product-test-results';OUT.mkdir(exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
certdir=tempfile.TemporaryDirectory();cert=Path(certdir.name)/'cert.pem';key=Path(certdir.name)/'key.pem'
subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=localhost'],check=True,capture_output=True)
tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);tls.load_cert_chain(cert,key);server.socket=tls.wrap_socket(server.socket,server_side=True)
threading.Thread(target=server.serve_forever,daemon=True).start()
origin=f'https://127.0.0.1:{server.server_port}';results=[]
def ready(page):
    for _ in range(150):
        if page.evaluate('Boolean(window.NOLU_PLANNER && window.PUPLAN_AUTH)'):return
        page.wait_for_timeout(100)
    raise AssertionError('Application did not initialize')
with sync_playwright() as p:
    for engine in ['chromium','webkit']:
        browser=getattr(p,engine).launch()
        for width in [390,1440]:
            key=f'{engine}-{width}'
            context=browser.new_context(viewport={'width':width,'height':900},locale='zh-TW',timezone_id='Asia/Taipei',service_workers='block',ignore_https_errors=True,accept_downloads=True)
            context.route('**/*',lambda route:route.continue_() if route.request.url.startswith(origin+'/') else route.abort())
            page=context.new_page();page.set_default_timeout(10000)
            errors=[];console=[];failed=[];checks=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('console',lambda e:console.append(e.type+': '+e.text))
            page.on('requestfailed',lambda r:failed.append({'url':r.url,'failure':r.failure}))
            page.clock.set_fixed_time('2026-10-12T07:00:00+08:00')
            try:
                page.goto(origin+'/pu-plan/');ready(page)
                expect(page.locator('#guestMode')).to_be_visible()
                assert page.locator('#guestMode').bounding_box()['y']<550
                page.screenshot(path=str(OUT/f'{key}-entry.png'),full_page=True,timeout=30000)
                checks.append('local-use entry is visible before registration fields')
                page.locator('#guestMode').click()
                page.screenshot(path=str(OUT/f'{key}-empty.png'),full_page=True,timeout=30000)
                expect(page.locator('#workspaceMode')).to_be_visible()
                expect(page.locator('#quickBackup')).to_be_disabled()
                if width==390:assert page.evaluate("document.body.classList.contains('schedule-day-mode')")
                checks.append('guest storage is explicit and new mobile sessions show a day')
                page.locator('[data-empty-add]').click();page.locator('#courseName').fill('資料庫系統')
                page.locator('#day').select_option('3');page.locator('#start').select_option('1');page.locator('#end').select_option('2')
                page.locator('#teacher').fill('林老師');page.locator('#room').fill('主顧 324')
                expect(page.locator('#coursePreview')).to_contain_text('星期三')
                expect(page.locator('#coursePreview')).to_contain_text('08:10')
                page.locator('#saveCourse').click()
                expect(page.locator('#humanWeek [data-week-day="3"] [data-course]')).to_be_visible()
                expect(page.locator('#quickBackup')).to_be_enabled()
                checks.append('saving a course selects its weekday and shows actual time')
                page.evaluate("document.querySelector('#add').click()")
                page.locator('#courseName').fill('資料 庫 系統');page.locator('#day').select_option('3')
                page.locator('#start').select_option('1');page.locator('#end').select_option('2')
                expect(page.locator('#coursePreview')).to_contain_text('課表已有')
                page.locator('#saveCourse').click();expect(page.locator('#courseError')).to_contain_text('重複')
                assert page.evaluate('PUPLAN_APP.courses().length')==1
                page.screenshot(path=str(OUT/f'{key}-duplicate.png'),full_page=True,timeout=30000)
                page.once('dialog',lambda d:d.accept());page.locator('#courseDialog [data-close]').first.click()
                checks.append('normalized duplicate cannot silently add a second course')
                page.locator('[data-schedule-mode="week"]').click();page.locator('[data-day-add="2"]').click()
                expect(page.locator('#day')).to_have_value('2')
                page.locator('#courseDialog [data-close]').first.click()
                with page.expect_download() as info:page.locator('#quickBackup').click()
                backup=json.loads(Path(info.value.path()).read_text());assert len(backup['courses'])==1
                assert set(backup)=={'format','version','exportedAt','courses','meta'}
                checks.append('weekday add and direct backup controls work')
                for test_width in [320,390,768,1440]:
                    page.set_viewport_size({'width':test_width,'height':900})
                    for view in ['schedule','friends','ai','settings']:
                        page.evaluate('(view)=>PUPLAN_APP.changeView(view)',view)
                        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),(test_width,view)
                checks.append('all four primary screens fit 320,390,768,1440px')
                page.set_viewport_size({'width':width,'height':900});page.evaluate("PUPLAN_APP.changeView('schedule')")
                if width==390:page.locator('[data-schedule-mode="day"]').click()
                # Opacity-only toasts still have a box; other versions explicitly hide it.
                expect(page.locator('#toast.on:not([hidden]):not(.hidden)')).to_have_count(0,timeout=10000)
                page.screenshot(path=str(OUT/f'{key}-schedule.png'),full_page=True,timeout=30000)
                assert not errors,errors
                checks.append('no uncaught JavaScript exceptions')
                results.append({'engine':engine,'width':width,'passed':checks,'error':None})
            except Exception:
                page.screenshot(path=str(OUT/f'{key}-failure.png'),full_page=True,timeout=30000)
                results.append({'engine':engine,'width':width,'passed':checks,'error':traceback.format_exc(),'console':console,'failed_requests':failed,'page_errors':errors,'html':page.content()[:15000]})
            finally:context.close()
        browser.close()
server.shutdown();certdir.cleanup()
(OUT/'daily-ui.json').write_text(json.dumps(results,ensure_ascii=False,indent=2))
print(json.dumps(results,ensure_ascii=False,indent=2))
if any(r['error'] for r in results):raise SystemExit(1)
