"""Course feedback journeys; local fixtures only, all external traffic blocked."""
import functools
import json
import threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'product-test-results'
OUT.mkdir(exist_ok=True)
COURSES = [
    dict(id='web', name='Web Development', day=1, start=1, end=2, color='blue'),
    dict(id='db', name='資料庫系統', day=1, start=3, end=4, color='mint'),
    dict(id='project', name='專題實作', day=3, start=6, end=8, color='violet'),
]
checks, errors = [], []
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=ROOT))
threading.Thread(target=server.serve_forever, daemon=True).start()
ORIGIN = f'http://127.0.0.1:{server.server_port}'
URL = ORIGIN + '/pu-plan/'
def passed(name):
    checks.append(name)
    print('PASS:', name, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={'width':390,'height':844}, locale='zh-TW', timezone_id='Asia/Taipei', service_workers='block')
    ctx.route('**/*', lambda route: route.continue_() if route.request.url.startswith(ORIGIN + '/') else route.abort())
    ctx.add_init_script("localStorage.setItem('puplan_guest','1');localStorage.setItem('nolu_guest_scope_v1','1')")
    page = ctx.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    dialogs = {'accept':True, 'count':0}
    def answer(dialog):
        dialogs['count'] += 1
        dialog.accept() if dialogs['accept'] else dialog.dismiss()
    page.on('dialog', answer)
    def seed(data=COURSES): page.evaluate('(data)=>PUPLAN_APP.setCoursesFromUser(data)', data)
    def close(): page.locator('#courseDialog [data-close]').first.click()
    def shot(name): page.screenshot(path=OUT / f'editor-{name}.png', full_page=True)
    try:
        page.clock.set_fixed_time('2026-10-12T07:00:00+08:00')
        page.goto(URL)
        expect(page.locator('#classPulse')).to_be_attached(timeout=15000)
        expect(page.locator('.bottom [data-community-open]')).to_be_attached(timeout=15000)
        seed()
        expect(page.locator('#humanWeek [data-day-add]')).to_have_count(5)
        page.locator('#humanWeek [data-day-add="2"]').click()
        expect(page.locator('#day')).to_have_value('2')
        expect(page.locator('#courseName')).to_be_focused()
        expect(page.locator('#courseTimeSummary')).to_contain_text('星期二')
        passed('weekday add selects the correct day and focuses the course name')
        page.locator('#courseName').fill('Ｗｅｂ  Development')
        page.locator('#day').select_option('1')
        page.locator('#start').select_option('1')
        page.locator('#end').select_option('2')
        expect(page.locator('#coursePreview')).to_have_attribute('data-state','duplicate')
        before = page.evaluate('JSON.stringify(PUPLAN_APP.courses())')
        prompts = dialogs['count']
        page.locator('#saveCourse').click()
        expect(page.locator('#courseError')).to_contain_text('重複')
        assert page.evaluate('JSON.stringify(PUPLAN_APP.courses())') == before
        assert dialogs['count'] == prompts
        expect(page.locator('#courseName')).to_have_value('Ｗｅｂ  Development')
        shot('duplicate-mobile')
        passed('normalized duplicate is blocked inline without a native prompt or lost draft')
        page.locator('#courseName').fill('系統分析')
        page.locator('#start').select_option('2')
        page.locator('#end').select_option('3')
        expect(page.locator('#courseChecks li')).to_have_count(2)
        expect(page.locator('#courseChecks')).to_contain_text('Web Development')
        expect(page.locator('#courseChecks')).to_contain_text('資料庫系統')
        expect(page.locator('#courseDuration')).to_contain_text('授課 100 分鐘')
        expect(page.locator('#courseDuration')).to_contain_text('10 分鐘課間休息')
        dialogs['accept'] = False
        page.locator('#saveCourse').click()
        assert page.evaluate('JSON.stringify(PUPLAN_APP.courses())') == before
        expect(page.locator('#courseDialog')).to_be_visible()
        dialogs['accept'] = True
        page.locator('#saveCourse').click()
        expect(page.locator('#courseDialog')).to_be_hidden()
        expect(page.locator('#count')).to_have_text('4')
        passed('all conflicts are previewed; declining preserves draft and explicit acceptance saves')
        seed()
        page.locator('#humanWeek [data-course="web"]').click()
        expect(page.locator('#coursePreview')).to_have_attribute('data-state','ready')
        page.locator('#room').fill('主顧 324')
        page.locator('#saveCourse').click()
        expect(page.locator('#count')).to_have_text('3')
        passed('editing an existing course is not mistaken for a duplicate')
        page.locator('#humanWeek [data-day-add="3"]').click()
        page.locator('#courseName').fill('實習說明')
        page.locator('#day').select_option('0')
        expect(page.locator('#courseTimeSummary')).to_contain_text('未排定')
        expect(page.locator('#courseChecks')).to_contain_text('不代表')
        expect(page.locator('#start')).to_be_disabled()
        page.locator('#saveCourse').click()
        assert page.evaluate("PUPLAN_APP.courses().find(c=>c.name==='實習說明').start") == 0
        passed('unscheduled entries explain uncertainty rather than claiming a free time slot')
        page.locator('#humanWeek [data-course="web"]').click()
        page.locator('#courseName').fill('不能覆蓋新資料')
        changed = [{**course, 'room':'另一裝置的新教室'} for course in COURSES]
        page.evaluate('(data)=>PUPLAN_APP.setRemoteCourses(data)', changed)
        remote = page.evaluate('JSON.stringify(PUPLAN_APP.courses())')
        page.locator('#saveCourse').click()
        expect(page.locator('#courseError')).to_contain_text('其他操作或裝置更新')
        assert page.evaluate('JSON.stringify(PUPLAN_APP.courses())') == remote
        close()
        passed('the existing concurrent-edit guard still prevents overwriting remote changes')
        seed([{**COURSES[0], 'name':'<img src=x onerror="window.injected=1">'}])
        page.locator('#humanWeek [data-day-add="1"]').click()
        page.locator('#courseName').fill('另一門課')
        page.locator('#start').select_option('1')
        page.locator('#end').select_option('2')
        expect(page.locator('#courseChecks')).to_contain_text('<img')
        expect(page.locator('#coursePreview img')).to_have_count(0)
        assert page.evaluate('window.injected === undefined')
        close()
        passed('course names in feedback are literal text, not executable HTML')
        seed()
        page.locator('#importSchedule').click()
        page.locator('#importDrop').focus()
        with page.expect_file_chooser(): page.locator('#importDrop').press('Enter')
        page.locator('#importDialog [data-close]').click()
        passed('the screenshot picker is operable with keyboard Enter')
        page.locator('[data-presentation="classic"]').click()
        page.locator('[data-schedule-mode="day"]').click()
        page.locator('#tabs [data-day="4"]').click()
        page.locator('#mobile .day-empty-add').click()
        expect(page.locator('#day')).to_have_value('4')
        close()
        passed('an empty single-day view has a correctly scoped add action')
        page.locator('[data-presentation="human"]').click()
        page.locator('[data-schedule-mode="week"]').click()
        for width in [320,390,768,1440]:
            page.set_viewport_size({'width':width,'height':844})
            seed()
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), width
            shot(f'schedule-{width}')
            page.locator('#humanWeek [data-day-add="1"]').click()
            page.locator('#courseName').fill('系統分析')
            expect(page.locator('#courseChecks')).to_contain_text('重疊')
            assert page.locator('#courseDialog').evaluate('(el)=>el.scrollWidth<=el.clientWidth'), width
            assert page.locator('#courseDialog .modal-head .x').bounding_box()['width'] >= 44
            shot(f'preview-{width}')
            close()
            passed(f'{width}px schedule and course feedback fit without horizontal overflow')
        page.set_viewport_size({'width':390,'height':480})
        page.locator('#humanWeek [data-day-add="1"]').click()
        page.locator('#courseName').fill('鍵盤開啟時也能操作')
        page.locator('#saveCourse').scroll_into_view_if_needed()
        box = page.locator('#saveCourse').bounding_box()
        assert box['y'] >= 0 and box['y']+box['height'] <= 480, box
        assert page.locator('#courseDialog').bounding_box()['height'] <= 457
        shot('short-viewport')
        close()
        passed('short-height viewport retains reachable save controls')
        assert not errors, errors
        passed('no uncaught JavaScript exceptions in the exercised editor journeys')
    except Exception:
        shot('failure')
        raise
    finally:
        (OUT/'editor-feedback-checks.json').write_text(json.dumps({'passed':checks,'page_errors':errors,'scope':'Chromium local fixtures; external APIs blocked; not a physical iPhone'},ensure_ascii=False,indent=2))
        browser.close(); server.shutdown()
