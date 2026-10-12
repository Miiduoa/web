"""Mobile weekly grid acceptance: real layouts, tap placement, and touch scrolling.

Only localhost is reachable. All course data is synthetic and browser-local.
NOLU_BROWSER selects the engine; NOLU_CHROMIUM_PATH optionally uses a local binary.
"""
import functools
import http.server
import json
import os
import ssl
import subprocess
import tempfile
import threading
import time
import traceback
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'product-test-results'
OUT.mkdir(exist_ok=True)
ENGINE = os.environ.get('NOLU_BROWSER', 'chromium')

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT)))
certdir = tempfile.TemporaryDirectory()
cert, keyfile = Path(certdir.name) / 'cert.pem', Path(certdir.name) / 'key.pem'
subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', str(keyfile), '-out', str(cert)], check=True, capture_output=True)
tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
tls.load_cert_chain(cert, keyfile)
server.socket = tls.wrap_socket(server.socket, server_side=True)
threading.Thread(target=server.serve_forever, daemon=True).start()
ORIGIN = f'https://127.0.0.1:{server.server_port}'
DATA = [
    dict(id='db', name='資料庫系統', day=1, start=3, end=4, teacher='林老師', room='主顧324', color='mint'),
    dict(id='net', name='網路通訊概論', day=2, start=1, end=2, room='主顧301', color='blue'),
    dict(id='talk', name='職場簡報技巧', day=3, start=6, end=7, room='伯鐸413', color='violet'),
    dict(id='design', name='資訊系統分析與設計', day=4, start=3, end=4, room='任垣404', color='orange'),
    dict(id='project', name='資訊管理專題', day=5, start=7, end=8, room='主顧410', color='pink'),
    dict(id='long', name='藝術經典與美學素養（永續與在地）', day=5, start=9, end=10, room='任垣443', color='gray'),
    dict(id='late', name='夜間課程', day=2, start=13, end=13, room='主顧301', color='lime'),
]
checks, errors, diagnostics = [], [], []
def passed(name):
    checks.append(name)
    print('PASS', name, flush=True)

with sync_playwright() as playwright:
    options = {}
    if ENGINE == 'chromium' and os.environ.get('NOLU_CHROMIUM_PATH'):
        options['executable_path'] = os.environ['NOLU_CHROMIUM_PATH']
    browser = getattr(playwright, ENGINE).launch(**options)
    context = browser.new_context(viewport={'width':390, 'height':844}, is_mobile=True, has_touch=True, locale='zh-TW', timezone_id='Asia/Taipei', service_workers='block', ignore_https_errors=True)
    context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(ORIGIN + '/') else route.abort())
    page = context.new_page()
    page.set_default_timeout(6000)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: diagnostics.append(m.text) if m.type == 'error' else None)
    def state():
        return page.evaluate('JSON.stringify(PUPLAN_APP.courses())')
    def seed():
        page.evaluate('(data)=>PUPLAN_APP.setCoursesFromUser(data)', DATA)
        expect(page.locator('#grid [data-course="db"]')).to_have_attribute('data-week-span', '2')
    def slot(day, period):
        return page.locator(f'#grid [data-slot="{day}:{period}"]')
    def tapslot(day, period):
        node=slot(day,period);node.scroll_into_view_if_needed();b=node.bounding_box()
        page.touchscreen.tap(b['x']+b['width']/2,b['y']+b['height']/2)
    def course(id='db'):
        return page.locator(f'#grid [data-course="{id}"]')
    def overview():
        page.locator('[data-week-scale="overview"]').tap()
    def frame():
        page.locator('#weekScale').scroll_into_view_if_needed()
        page.evaluate("()=>{const wrap=document.querySelector('#grid').closest('.table-wrap');wrap.scrollTo({top:0,left:0,behavior:'instant'});const bar=document.querySelector('.topbar').getBoundingClientRect();window.scrollTo({top:Math.max(0,scrollY+document.querySelector('#weekScale').getBoundingClientRect().top-bar.height-10),behavior:'instant'})}")
    def close():
        page.locator('#courseDialog [data-close]').first.tap()
    def pick():
        course().tap()
        expect(page.locator('#courseName')).to_have_value('資料庫系統')
        page.locator('#weekMoveFromEditor').tap()
        expect(page.locator('#cancelPlacement')).to_be_visible()
    try:
        page.clock.set_fixed_time('2026-10-12T07:00:00+08:00')
        page.goto(ORIGIN + '/pu-plan/')
        for _ in range(150):
            if page.evaluate('Boolean(window.PUPLAN_AUTH && window.NOLU_PLANNER)'):
                break
            time.sleep(.1)
        else:
            raise AssertionError('Application did not initialize: ' + str(diagnostics))
        page.locator('#guestMode').tap()
        page.locator('[data-schedule-mode="week"]').tap()
        page.locator('[data-presentation="classic"]').tap()
        seed()
        expect(page.locator('[data-week-scale="overview"]')).to_have_attribute('aria-pressed','true')
        before = state()
        for width in [320, 375, 390, 430, 680]:
            page.set_viewport_size({'width':width, 'height':844})
            frame()
            layout = page.evaluate("""()=>{
              const grid=document.querySelector('#grid'), wrap=grid.closest('.table-wrap'), r=wrap.getBoundingClientRect();
              const fri=grid.querySelector('[data-slot="5:1"]').getBoundingClientRect();
              const cards=[...grid.querySelectorAll('[data-course]')].map(el=>({w:el.getBoundingClientRect().width,h:el.getBoundingClientRect().height,font:parseFloat(getComputedStyle(el.querySelector('b')).fontSize)}));
              return {page:document.documentElement.scrollWidth,viewport:innerWidth,scroll:wrap.scrollWidth,client:wrap.clientWidth,friday:fri.right,right:r.right,cards};
            }""")
            assert layout['page'] <= width+1, layout
            assert layout['scroll'] <= layout['client']+1, layout
            assert layout['friday'] <= layout['right']+1, layout
            assert all(c['w'] >= 44 and c['h'] >= 44 and c['font'] >= 12 for c in layout['cards']), layout
            expect(page.locator('#grid .course-move-handle').first).not_to_be_visible()
            assert state() == before
        passed('five weekdays fit 320/375/390/430/680px without horizontal scrolling, with >=44px course targets and >=12px titles')
        page.set_viewport_size({'width':390,'height':844});frame()
        expect(page.locator('#toast.on:not([hidden])')).to_have_count(0,timeout=6000)
        frame()
        page.screenshot(path=str(OUT/f'mobile-week-{ENGINE}-overview.png'))
        course().tap();expect(page.locator('#teacher')).to_have_value('林老師');expect(page.locator('#room')).to_have_value('主顧324');close()
        passed('tapping a compact course opens the complete existing editor including teacher and room')
        slot(5,5).tap();expect(page.locator('#day')).to_have_value('5');expect(page.locator('#start')).to_have_value('5');expect(page.locator('#end')).to_have_value('5');close()
        assert state() == before
        passed('Friday is directly tappable and a canceled blank-slot draft does not change any courses')
        pick();slot(5,3).tap()
        assert page.evaluate("PUPLAN_APP.courses().find(c=>c.id==='db').day===5")
        assert page.evaluate("PUPLAN_APP.courses().find(c=>c.id==='db').end===4")
        expect(page.locator('#courseDialog')).not_to_be_visible()
        page.locator('#undoCourseMove').tap();assert state() == before
        passed('tap editor move then Friday changes only placement, preserves duration, and undo restores the exact original')
        course().tap();page.locator('#room').fill('尚未儲存的教室')
        page.once('dialog',lambda d:d.dismiss());page.locator('#weekMoveFromEditor').tap()
        expect(page.locator('#courseDialog')).to_be_visible();assert state()==before
        page.once('dialog',lambda d:d.accept());page.locator('#weekMoveFromEditor').tap()
        expect(page.locator('#courseDialog')).not_to_be_visible();page.locator('#cancelPlacement').tap();assert state()==before
        passed('move entry respects the unsaved-form discard confirmation and never saves the abandoned draft')
        pick();tapslot(4,3);expect(page.locator('#moveConflictDialog')).to_be_visible()
        expect(page.locator('.move-conflicts')).to_contain_text('資訊系統分析與設計')
        page.locator('#cancelCourseMove').tap();assert state()==before
        pick();tapslot(4,3);page.locator('#confirmCourseMove').tap()
        assert page.evaluate("PUPLAN_APP.courses().length") == len(DATA)
        page.locator('#undoCourseMove').tap();assert state()==before
        passed('conflicting placement still requires confirmation, preserves both courses and remains undoable')
        pick();page.locator('[data-week-scale="detail"]').tap();expect(page.locator('#cancelPlacement')).not_to_be_visible();assert state()==before
        passed('changing scale cancels pending placement without writing data')
        page.locator('[data-week-jump="5"]').tap();frame_top = page.locator('#grid').locator('.cell.head').last.bounding_box()
        wrap_box = page.locator('#grid').evaluate("el=>{const r=el.closest('.table-wrap').getBoundingClientRect();return {left:r.left,right:r.right}}")
        assert frame_top['x'] >= wrap_box['left'] and frame_top['x']+frame_top['width'] <= wrap_box['right']+1
        page.locator('#grid').evaluate("el=>el.closest('.table-wrap').scrollTop=260")
        pinned=page.locator('#grid').evaluate("""el=>{const wrap=el.closest('.table-wrap').getBoundingClientRect(),h=el.querySelector('.cell.head').getBoundingClientRect(),t=el.querySelector('.cell.time').getBoundingClientRect();return {top:h.top,wrapTop:wrap.top,left:t.left,wrapLeft:wrap.left}}""")
        assert abs(pinned['top']-pinned['wrapTop'])<=2 and abs(pinned['left']-pinned['wrapLeft'])<=2,pinned
        expect(page.locator('#grid .course-move-handle').last).to_be_visible()
        page.screenshot(path=str(OUT/f'mobile-week-{ENGINE}-detail.png'))
        passed('enlarged view has real weekday scroll shortcuts and sticky weekday/time labels after two-axis scrolling')
        overview();frame();pick()
        page.locator('#grid .cell.head').last.tap();assert state()==before
        expect(page.locator('#cancelPlacement')).to_be_visible();page.locator('#cancelPlacement').tap()
        passed('tapping a pinned label never drops through to a hidden course slot')
        if ENGINE=='chromium':
            frame();session=context.new_cdp_session(page)
            box=course().bounding_box();x=box['x']+box['width']/2;y=box['y']+30
            session.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[{'x':x,'y':y}]})
            for delta in range(15,136,15):
                session.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[{'x':x,'y':y-delta}]});page.wait_for_timeout(25)
            session.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
            # Wait for native fling scrolling to finish before starting a separate tap.
            # A tap during a fling stops scrolling rather than activating the control.
            last_position=None; stable=0
            for _ in range(40):
                page.wait_for_timeout(100)
                position=page.evaluate("[scrollY,document.querySelector('#grid').closest('.table-wrap').scrollTop]")
                stable=stable+1 if position==last_position else 0
                last_position=position
                if stable>=3: break
            assert stable>=3, 'Native touch scrolling did not settle'
            expect(page.locator('#courseDialog')).not_to_be_visible();assert state()==before
            assert page.locator('#grid').evaluate("el=>el.closest('.table-wrap').scrollTop")>0
            passed('real Chromium touch swipe over a course scrolls the weekly grid without opening or moving it')
        page.locator('[data-week-scale="detail"]').tap()
        expect(page.locator('[data-week-scale="detail"]')).to_have_attribute('aria-pressed','true')
        assert page.evaluate("localStorage.getItem('nolu_week_scale_v1')")=='detail'
        page.reload()
        expect(page.locator('[data-week-scale="detail"]')).to_have_attribute('aria-pressed','true')
        assert state()==before
        passed('scale preference and the same guest courses survive reload')
        overview();page.set_viewport_size({'width':1440,'height':900})
        expect(page.locator('#weekScale')).not_to_be_visible()
        expect(page.locator('#grid .course-move-handle').first).to_be_visible()
        expect(page.locator('#grid .cell.head').nth(1)).to_contain_text('星期一')
        passed('desktop keeps the existing weekly grid, complete weekday labels and drag handles')
        page.set_viewport_size({'width':390,'height':844});page.locator('[data-presentation="human"]').tap()
        expect(page.locator('#humanWeek')).to_be_visible();assert page.locator('.human-day').count()==5
        expect(page.locator('#weekScale')).not_to_be_visible()
        page.locator('[data-schedule-mode="day"]').tap();expect(page.locator('#tabs')).to_be_visible()
        assert state()==before
        passed('weekly list and daily view are both retained without changing the timetable')
        assert not errors, errors
        assert not [e for e in diagnostics if 'module failed' in e], diagnostics
        passed('no uncaught exceptions or failed application modules')
    except Exception:
        errors.append(traceback.format_exc())
        diagnostics.append(page.evaluate("JSON.stringify({scale:localStorage.getItem('nolu_week_scale_v1'),selected:document.querySelector('#classicSchedule')?.dataset.weekDensity,scrollY,viewport:innerWidth})"))
        page.screenshot(path=str(OUT/f'mobile-week-{ENGINE}-failure.png'),full_page=True)
    finally:
        (OUT/f'mobile-week-{ENGINE}.json').write_text(json.dumps({'checks':checks,'errors':errors,'diagnostics':diagnostics},ensure_ascii=False,indent=2))
        context.close();browser.close();server.shutdown()
if errors:
    print('\n'.join(errors))
    raise SystemExit(1)
