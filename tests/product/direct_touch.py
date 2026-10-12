"""Mobile taps in both engines; Chromium additionally receives real touch input via CDP."""
import functools, http.server, json, os, ssl, subprocess, tempfile, threading, time, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[2]; OUT=ROOT/'product-test-results'; OUT.mkdir(exist_ok=True)
ENGINE=os.environ.get('NOLU_BROWSER','chromium')
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
certdir=tempfile.TemporaryDirectory();cert=Path(certdir.name)/'cert.pem';key=Path(certdir.name)/'key.pem'
subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-keyout',str(key),'-out',str(cert)],capture_output=True,check=True)
tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);tls.load_cert_chain(cert,key);server.socket=tls.wrap_socket(server.socket,server_side=True)
threading.Thread(target=server.serve_forever,daemon=True).start();ORIGIN=f'https://127.0.0.1:{server.server_port}'
DATA=[dict(id='db',name='資料庫系統',day=1,start=3,end=4,teacher='林老師',room='主顧 324',color='mint')]
checks=[];errors=[]
def passed(name): checks.append(name);print('PASS',name,flush=True)
with sync_playwright() as p:
    browser=getattr(p,ENGINE).launch()
    ctx=browser.new_context(viewport={'width':390,'height':844},is_mobile=True,has_touch=True,device_scale_factor=1,locale='zh-TW',timezone_id='Asia/Taipei',service_workers='block',ignore_https_errors=True)
    ctx.route('**/*',lambda route:route.continue_() if route.request.url.startswith(ORIGIN+'/') else route.abort())
    page=ctx.new_page();page.set_default_timeout(8000);page.on('pageerror',lambda error:errors.append(str(error)))
    def state():return page.evaluate('JSON.stringify(PUPLAN_APP.courses())')
    def slot(day,period):return page.locator(f'#grid [data-slot="{day}:{period}"]')
    def handle():return page.locator('#grid [data-move-course="db"]')
    def center(locator):
        b=locator.bounding_box();assert b is not None
        return {'x':b['x']+b['width']/2,'y':b['y']+b['height']/2}
    def frame():
        page.evaluate("()=>{const grid=document.querySelector('#grid');grid.closest('.table-wrap').scrollLeft=0;window.scrollBy(0,grid.getBoundingClientRect().top-115)}")
        page.wait_for_timeout(100)
    def seed():
        page.evaluate('(data)=>PUPLAN_APP.setCoursesFromUser(data)',DATA)
        expect(handle()).to_be_attached();frame()
    def shot(name):page.screenshot(path=str(OUT/f'direct-{ENGINE}-touch-{name}.png'))
    try:
        page.clock.set_fixed_time('2026-10-12T07:00:00+08:00');page.goto(ORIGIN+'/pu-plan/')
        for _ in range(150):
            if page.evaluate('Boolean(window.PUPLAN_AUTH && window.NOLU_PLANNER)'):break
            time.sleep(.1)
        else:raise AssertionError('Application did not initialize')
        page.locator('#guestMode').tap();page.locator('.direct-grid-entry').tap();seed()
        slot(2,5).tap();expect(page.locator('#day')).to_have_value('2');expect(page.locator('#start')).to_have_value('5');expect(page.locator('#end')).to_have_value('5')
        page.locator('#courseDialog [data-close]').first.tap()
        passed('touch tap on a blank weekly slot opens the exact prefilled draft')
        seed();before=state();handle().tap();expect(page.locator('#cancelPlacement')).to_be_visible()
        slot(2,5).tap();assert page.evaluate("PUPLAN_APP.courses()[0].day===2 && PUPLAN_APP.courses()[0].start===5 && PUPLAN_APP.courses()[0].end===6")
        expect(page.locator('#courseDialog')).not_to_be_visible();page.locator('#undoCourseMove').tap();assert state()==before
        passed('mobile tap-handle/tap-destination moves once and undo restores the original')
        seed();assert handle().evaluate("el=>getComputedStyle(el).touchAction")=='none'
        assert page.locator('#grid [data-course="db"]').evaluate("el=>getComputedStyle(el).touchAction")!='none'
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        passed('only the move handle suppresses native touch scrolling and the page has no horizontal overflow')
        if ENGINE=='chromium':
            cdp=ctx.new_cdp_session(page)
            def touch(kind,point=None):
                cdp.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':[{**point,'id':1,'radiusX':3,'radiusY':3,'force':1}] if point else []})
            def swipe(a,b,cancel=False):
                touch('touchStart',a)
                for step in range(1,13):
                    touch('touchMove',{'x':a['x']+(b['x']-a['x'])*step/12,'y':a['y']+(b['y']-a['y'])*step/12});page.wait_for_timeout(20)
                touch('touchCancel' if cancel else 'touchEnd')
                page.wait_for_timeout(150)
            seed();before=state();body=page.locator('#grid [data-course="db"]').bounding_box();a={'x':body['x']+35,'y':body['y']+body['height']*.65}
            old_scroll=page.evaluate('scrollY');swipe(a,{'x':a['x'],'y':a['y']-170})
            assert state()==before;expect(page.locator('#courseDialog')).not_to_be_visible();assert page.evaluate('scrollY')>old_scroll+30
            passed('real touch swipe on course body scrolls vertically without moving the course or opening its editor')
            seed();before=state();a=center(slot(2,5));swipe(a,{'x':90,'y':a['y']})
            assert state()==before;assert page.locator('.table-wrap').evaluate('el=>el.scrollLeft')>30;expect(page.locator('#courseDialog')).not_to_be_visible()
            passed('real horizontal swipe on blank cells scrolls the weekly grid without creating a course')
            seed();before=state();a=center(handle());b=center(slot(2,5));touch('touchStart',a)
            for step in range(1,13):
                touch('touchMove',{'x':a['x']+(b['x']-a['x'])*step/12,'y':a['y']+(b['y']-a['y'])*step/12});page.wait_for_timeout(20)
            expect(page.locator('#directPreview')).to_be_visible();assert state()==before;shot('drag-preview')
            b=center(slot(2,5));touch('touchMove',b);touch('touchEnd');page.wait_for_timeout(150)
            assert page.evaluate("PUPLAN_APP.courses()[0].day===2 && PUPLAN_APP.courses()[0].start===5 && PUPLAN_APP.courses()[0].end===6")
            expect(page.locator('#courseDialog')).not_to_be_visible();page.locator('#undoCourseMove').tap();assert state()==before
            passed('real touch drag from the handle previews without writing and moves the intact course on release')
            seed();before=state();swipe(center(handle()),center(slot(2,5)),cancel=True);assert state()==before;expect(page.locator('#directPreview')).not_to_be_visible()
            passed('touch cancellation leaves no move, draft or lingering preview')
        seed();shot('grid');assert not errors,errors
        passed('no uncaught exceptions during the mobile touch journeys')
    except Exception:
        (OUT/f'direct-{ENGINE}-touch-error.txt').write_text(traceback.format_exc()+'\n'+state())
        shot('failure');raise
    finally:
        (OUT/f'direct-{ENGINE}-touch-checks.json').write_text(json.dumps({'passed':checks,'page_errors':errors,'scope':'390x844 touch emulation; Chromium CDP gestures, WebKit taps; not a physical iPhone'},ensure_ascii=False,indent=2))
        ctx.close();browser.close();server.shutdown();certdir.cleanup()
