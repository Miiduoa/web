"""Real pointer journeys on the application; external APIs and real accounts are blocked."""
import functools, http.server, json, os, ssl, subprocess, tempfile, threading, time, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT/'product-test-results'; OUT.mkdir(exist_ok=True)
ENGINE=os.environ.get('NOLU_BROWSER','chromium')
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
certdir=tempfile.TemporaryDirectory();cert=Path(certdir.name)/'cert.pem';key=Path(certdir.name)/'key.pem'
subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-keyout',str(key),'-out',str(cert)],capture_output=True,check=True)
sslcontext=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);sslcontext.load_cert_chain(cert,key);server.socket=sslcontext.wrap_socket(server.socket,server_side=True)
threading.Thread(target=server.serve_forever,daemon=True).start();ORIGIN=f'https://127.0.0.1:{server.server_port}'
DATA=[dict(id='db',name='資料庫系統',day=1,start=3,end=4,teacher='林老師',room='主顧 324',color='mint'),dict(id='math',name='資料分析',day=3,start=3,end=4,teacher='王老師',room='主顧 301',color='blue')]
checks=[];errors=[]
def passed(name): checks.append(name);print('PASS',name,flush=True)
with sync_playwright() as p:
    options={'executable_path':os.environ['NOLU_BROWSER_PATH']} if os.environ.get('NOLU_BROWSER_PATH') else {}
    browser=getattr(p,ENGINE).launch(**options)
    ctx=browser.new_context(viewport={'width':1440,'height':1000},locale='zh-TW',timezone_id='Asia/Taipei',service_workers='block',ignore_https_errors=True)
    ctx.route('**/*',lambda route:route.continue_() if route.request.url.startswith(ORIGIN+'/') else route.abort())
    page=ctx.new_page();page.set_default_timeout(8000);page.on('pageerror',lambda error:errors.append(str(error)))
    def state(): return page.evaluate('JSON.stringify(PUPLAN_APP.courses())')
    def course(): return page.evaluate("PUPLAN_APP.courses().find(c=>c.id==='db')")
    def seed(data=DATA):
        page.evaluate('(data)=>PUPLAN_APP.setCoursesFromUser(data)',data)
        expect(page.locator('#grid [data-slot]')).to_have_count(65)
        page.wait_for_timeout(30)
    def slot(day,period): return page.locator(f'#grid [data-slot="{day}:{period}"]')
    def handle(id='db'): return page.locator(f'#grid [data-move-course="{id}"]')
    def center(locator):
        box=locator.bounding_box();assert box is not None
        return {'x':box['x']+box['width']/2,'y':box['y']+box['height']/2}
    def clickslot(day,period):
        locator=slot(day,period);locator.scroll_into_view_if_needed();page.mouse.click(**center(locator))
    def drag_to(day,period,source=None):
        source=source or handle();source.scroll_into_view_if_needed();a=center(source);b=center(slot(day,period))
        page.mouse.move(**a);page.mouse.down();page.mouse.move(**b,steps=12);page.mouse.up();page.wait_for_timeout(80)
    def close_editor(dirty=False):
        if dirty:page.once('dialog',lambda d:d.accept())
        page.locator('#courseDialog [data-close]').first.click()
    def shot(name):page.screenshot(path=str(OUT/f'direct-{ENGINE}-{name}.png'),full_page='preview' not in name)
    try:
        page.clock.set_fixed_time('2026-10-12T07:00:00+08:00')
        page.goto(ORIGIN+'/pu-plan/')
        for _ in range(150):
            if page.evaluate('Boolean(window.PUPLAN_AUTH && window.NOLU_PLANNER)'): break
            time.sleep(.1)
        else: raise AssertionError('Application did not initialize')
        page.locator('#guestMode').click();page.locator('.direct-grid-entry').click()
        expect(page.locator('#grid')).to_be_visible();expect(page.locator('[data-presentation="classic"]')).to_have_attribute('aria-pressed','true')
        clickslot(2,5);expect(page.locator('#day')).to_have_value('2');expect(page.locator('#start')).to_have_value('5');expect(page.locator('#end')).to_have_value('5')
        expect(page.locator('#courseName')).to_be_focused();page.locator('#courseName').fill('資訊安全');page.locator('#saveCourse').click()
        assert page.evaluate('PUPLAN_APP.courses()[0].start')==5
        passed('empty grid tap prefills the exact weekday and single period and saves through the existing editor')
        seed();page.locator('#grid [data-course="db"]').click();expect(page.locator('#courseName')).to_have_value('資料庫系統');close_editor()
        passed('single-click on an existing course still opens its ordinary editor')
        seed();slot(2,2).scroll_into_view_if_needed();a=center(slot(2,2));b=center(slot(2,5));page.mouse.move(**a);page.mouse.down();page.mouse.move(**b,steps=10);page.mouse.up()
        expect(page.locator('#start')).to_have_value('2');expect(page.locator('#end')).to_have_value('5');expect(page.locator('#day')).to_have_value('2');close_editor()
        assert len(json.loads(state()))==2
        passed('dragging across blank periods opens a prefilled multi-period draft without changing existing courses')
        seed();before=state();handle().scroll_into_view_if_needed();a=center(handle());b=center(slot(2,6));page.mouse.move(**a);page.mouse.down();page.mouse.move(**b,steps=10)
        expect(page.locator('#directPreview')).to_be_visible();assert state()==before
        shot('drag-preview-desktop');page.mouse.up()
        expect(page.locator('#courseDialog')).not_to_be_visible();assert (course()['day'],course()['start'],course()['end'])==(2,6,7)
        assert course()['room']=='主顧 324';expect(page.locator('#directUndo')).to_be_visible()
        page.locator('#undoCourseMove').click();assert state()==before
        passed('drag preview is read-only; drop moves the whole duration, avoids opening editor and supports exact undo')
        seed();before=state();handle().click();expect(page.locator('#cancelPlacement')).to_be_visible();clickslot(4,5)
        assert (course()['day'],course()['start'],course()['end'])==(4,5,6)
        page.locator('#undoCourseMove').click();assert state()==before
        passed('tap handle then tap destination offers the same move without dragging')
        seed();before=state();drag_to(3,3)
        expect(page.locator('#moveConflictDialog')).to_be_visible();expect(page.locator('.move-conflicts')).to_contain_text('資料分析');assert state()==before
        page.locator('#cancelCourseMove').click();assert state()==before
        drag_to(3,3);page.locator('#confirmCourseMove').click();assert course()['day']==3;assert len(json.loads(state()))==2
        page.locator('#undoCourseMove').click();assert state()==before
        passed('occupied destination lists conflicts and requires explicit confirmation; cancel and undo retain every course')
        seed();handle().click();clickslot(3,3);expect(page.locator('#moveConflictDialog')).to_be_visible()
        newer=[{**c,'room':'另一裝置新教室'} for c in DATA];page.evaluate('(data)=>PUPLAN_APP.setRemoteCourses(data)',newer);remote=state()
        page.locator('#confirmCourseMove').click();expect(page.locator('#moveError')).to_contain_text('更新');assert state()==remote;page.locator('#cancelCourseMove').click()
        passed('an update arriving during conflict confirmation cannot be overwritten')
        seed();before=state();handle().click();slot(2,13).scroll_into_view_if_needed();clickslot(2,13)
        assert state()==before;expect(page.locator('#directStatus')).to_contain_text('縮短');page.locator('#cancelPlacement').click()
        passed('a two-period course cannot be dropped into the final single period or silently truncated')
        seed();before=state();handle().scroll_into_view_if_needed();a=center(handle());b=center(slot(2,6));page.mouse.move(**a);page.mouse.down();page.mouse.move(**b,steps=10);page.keyboard.press('Escape');page.mouse.up();assert state()==before
        page.wait_for_timeout(470);handle().scroll_into_view_if_needed();a=center(handle());page.mouse.move(**a);page.mouse.down();page.mouse.move(20,80,steps=12);page.mouse.up();assert state()==before
        passed('Escape and dropping outside the grid leave the timetable untouched')
        page.wait_for_timeout(470);seed();handle().scroll_into_view_if_needed();a=center(handle());b=center(slot(2,5));page.mouse.move(**a);page.mouse.down();page.mouse.move(**b,steps=8)
        page.evaluate('(data)=>PUPLAN_APP.setRemoteCourses(data)',newer);remote=state();page.mouse.up();assert state()==remote
        passed('a remote render during a drag cancels stale placement')
        page.wait_for_timeout(470);seed();drag_to(2,5);expect(page.locator('#directUndo')).to_be_visible();page.evaluate('(data)=>PUPLAN_APP.setRemoteCourses(data)',newer)
        expect(page.locator('#directUndo')).not_to_be_visible();assert state()==remote
        passed('undo is invalidated by newer data rather than restoring an old snapshot')
        seed();before=state();page.evaluate("""()=>{window.realSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='puplan_courses')throw new DOMException('full','QuotaExceededError');return window.realSetItem.call(this,k,v)}}""")
        handle().click();clickslot(2,5);assert state()==before;expect(page.locator('#directUndo')).not_to_be_visible()
        page.evaluate('Storage.prototype.setItem=window.realSetItem')
        passed('storage failure does not claim success, lose data or offer a false undo')
        seed();start_cell=page.locator('#grid [data-slot="1:1"]');start_cell.focus();page.keyboard.press('ArrowRight');focused=page.evaluate('document.activeElement.dataset.slot');assert focused=='2:1'
        page.keyboard.press('Enter');expect(page.locator('#courseDialog')).to_be_visible();close_editor()
        handle().focus();page.keyboard.press('Enter');expect(page.locator('#cancelPlacement')).to_be_visible();page.keyboard.press('Escape')
        passed('keyboard users can choose blank periods and move controls, with a non-drag editor alternative')
        seed();handle().click();page.locator('[data-presentation="human"]').click();expect(page.locator('#cancelPlacement')).not_to_be_visible()
        page.locator('.direct-grid-entry').click()
        passed('switching view cancels selection without leaking drag state into lists')
        seed();before=state();handle().click();page.evaluate("localStorage.setItem('puplan_course_owner','another-account');window.dispatchEvent(new StorageEvent('storage',{key:'puplan_course_owner'}))")
        expect(page.locator('#cancelPlacement')).not_to_be_visible();page.evaluate("localStorage.removeItem('puplan_course_owner')")
        passed('account-scope changes invalidate pending selection')
        for width in [320,390,768,1440]:
            page.set_viewport_size({'width':width,'height':1000});seed()
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
            assert handle().bounding_box()['width']>=44
            shot(f'grid-{width}')
        passed('320/390/768/1440px layouts avoid page overflow and retain a 44px move target')
        assert not errors,errors;passed('no uncaught JavaScript exceptions in desktop mouse and keyboard journeys')
    except Exception:
        (OUT/f'direct-{ENGINE}-error.txt').write_text(traceback.format_exc()+'\n'+page.locator('#directStatus').inner_text()+'\n'+state())
        shot('failure');raise
    finally:
        (OUT/f'direct-{ENGINE}-checks.json').write_text(json.dumps({'passed':checks,'page_errors':errors,'scope':'isolated HTTPS browser, production APIs blocked; no real account data'},ensure_ascii=False,indent=2))
        ctx.close();browser.close();server.shutdown();certdir.cleanup()
