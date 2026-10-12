"""Isolated product journeys. Never signs in or sends writes to a real API."""
import functools
import json
import os
from pathlib import Path
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'product-test-results'
OUT.mkdir(exist_ok=True)
COURSES = [
    dict(id='c1', name='資料庫管理', day=1, start=3, end=4, room='主顧 324', teacher='王老師', color='blue'),
    dict(id='c2', name='行動應用軟體開發', day=1, start=6, end=8, room='主顧 301', teacher='林老師', color='mint'),
    dict(id='c3', name='系統分析與設計', day=2, start=2, end=4, room='主顧 324', teacher='陳老師', color='violet'),
    dict(id='c4', name='資訊安全', day=3, start=6, end=8, room='主顧 301', teacher='陳老師', color='orange'),
    dict(id='c5', name='專題實作', day=5, start=3, end=4, room='主顧 301', teacher='李老師', color='pink'),
]
checks = []
errors = []

def passed(name):
    checks.append(dict(name=name, passed=True))
    print('PASS:', name, flush=True)

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=ROOT))
threading.Thread(target=server.serve_forever, daemon=True).start()
ORIGIN = f'http://127.0.0.1:{server.server_port}'
URL = ORIGIN + '/pu-plan/'

with sync_playwright() as p:
    options = {'headless': True}
    if os.environ.get('CHROMIUM_PATH'):
        options['executable_path'] = os.environ['CHROMIUM_PATH']
    browser = p.chromium.launch(**options)
    page = None

    def context(width=390, guest=True):
        ctx = browser.new_context(viewport={'width': width, 'height': 844}, locale='zh-TW', timezone_id='Asia/Taipei', service_workers='block')
        ctx.route('**/*', lambda route: route.continue_() if route.request.url.startswith(ORIGIN + '/') else route.abort())
        if guest:
            ctx.add_init_script("localStorage.setItem('puplan_guest','1');localStorage.setItem('nolu_guest_scope_v1','1')")
        return ctx

    def ready(pg, suffix=''):
        pg.on('pageerror', lambda error: errors.append(str(error)))
        pg.on('dialog', lambda dialog: dialog.accept())
        pg.goto(URL + suffix)
        expect(pg.locator('#classPulse')).to_be_attached(timeout=15000)
        expect(pg.locator('.bottom [data-community-open]')).to_be_attached(timeout=15000)
        assert pg.evaluate('!!window.PUPLAN_APP && !!window.PUPLAN_CLOUD')
        pg.wait_for_timeout(300)

    def seed(pg, courses=COURSES):
        pg.evaluate('(courses)=>window.PUPLAN_APP.setCoursesFromUser(courses)', courses)

    def tab(pg, view):
        pg.locator(f'.bottom [data-view="{view}"]').click()
        expect(pg.locator(f'#{view}')).to_have_class('view on')

    def shot(pg, name):
        pg.screenshot(path=OUT / f'experience-{name}.png', full_page=True)

    try:
        ctx = context()
        page = ctx.new_page()
        ready(page)
        seed(page)
        expect(page.locator('#count')).to_have_text('5')
        page.locator('.bottom [data-community-open]').click()
        expect(page.locator('#community')).to_have_class('view on')
        expect(page.locator('#mobileAdd')).to_be_hidden()
        expect(page.locator('#importSchedule')).to_be_hidden()
        expect(page.locator('#shareTop')).to_be_hidden()
        assert page.locator('.view.on').count() == 1
        assert page.locator('#schedule').evaluate('(el)=>el.inert')
        passed('community reconciles header actions and inactive-view accessibility')
        tab(page, 'settings')
        page.go_back()
        expect(page.locator('#community')).to_have_class('view on')
        page.go_back()
        expect(page.locator('#schedule')).to_have_class('view on')
        page.go_forward()
        expect(page.locator('#community')).to_have_class('view on')
        page.go_forward()
        expect(page.locator('#settings')).to_have_class('view on')
        passed('Back and Forward restore all primary destinations, including community')
        assert page.evaluate("window.PUPLAN_APP.changeView('toString')") is False
        expect(page.locator('#settings')).to_have_class('view on')
        passed('unknown navigation destination cannot blank the app')
        page.locator('#name').fill('尚未儲存的名稱')
        page.evaluate('window.PUPLAN_APP.renderShare()')
        expect(page.locator('#name')).to_have_value('尚未儲存的名稱')
        passed('background share rendering preserves an unsaved name')
        code = page.evaluate("""async ()=>{
          const {encodeShareCode}=await import('./core/share-code.js');
          return encodeShareCode({v:1,id:'friend-snapshot',name:'朋友甲',t:Date.now()-1000,courses:window.PUPLAN_APP.courses(),meta:{}});
        }""")
        before = page.evaluate('JSON.stringify(window.PUPLAN_APP.courses())')
        page.locator('#readShare').click()
        page.locator('#friendCode').fill(code)
        expect(page.locator('#sharePreview')).to_contain_text('朋友甲・5 門課')
        assert page.evaluate('window.PUPLAN_APP.friends().length') == 0
        shot(page, 'share-preview-mobile')
        page.locator('#friendDialog [data-close]').first.click()
        assert page.evaluate('window.PUPLAN_APP.friends().length') == 0
        page.locator('#readShare').click()
        page.locator('#friendCode').fill(code)
        page.locator('#friendForm [type="submit"]').click()
        expect(page.locator('#friends')).to_have_class('view on')
        assert page.evaluate('window.PUPLAN_APP.friends()[0].cloud') is False
        assert page.evaluate('JSON.stringify(window.PUPLAN_APP.courses())') == before
        passed('share preview/cancel never mutates data; confirm stores only a snapshot')
        page.locator('[data-friend="friend-snapshot"]').click()
        expect(page.locator('#friendView')).to_contain_text('未驗證課表副本')
        page.locator('[data-friend-tool="overlay"]').click()
        expect(page.locator('#friendView')).to_contain_text('無法直接發送邀約')
        for invite in page.locator('#friendView [data-invite-kind]').all():
            expect(invite).to_be_disabled()
        passed('a local snapshot cannot masquerade as a verified friendship or send invites')
        tab(page, 'schedule')
        overlaps = [COURSES[0], {**COURSES[1], 'start': 3, 'end': 5}]
        seed(page, overlaps)
        expect(page.locator('#scheduleWarnings')).to_contain_text('1 組')
        page.locator('[data-schedule-mode="week"]').click()
        page.locator('[data-presentation="classic"]').click()
        expect(page.locator('#tabs')).to_be_hidden()
        expect(page.locator('#grid [data-conflict]')).to_have_count(1)
        page.locator('#grid [data-conflict]').click()
        expect(page.locator('#scheduleConflictDialog [data-edit-conflict]')).to_have_count(2)
        shot(page, 'conflict-mobile')
        page.locator('#scheduleConflictDialog [data-edit-conflict="c2"]').click()
        expect(page.locator('#courseId')).to_have_value('c2')
        page.locator('#courseDialog [data-close]').first.click()
        passed('overlapping grid courses remain separately inspectable and editable')
        page.locator('#jumpToday').click()
        expect(page.locator('#tabs')).to_be_visible()
        page.locator('#tabs [data-day="3"]').click()
        page.locator('#tabs [data-day="3"]').press('ArrowRight')
        expect(page.locator('#tabs [data-day="4"]')).to_be_focused()
        expect(page.locator('#tabs [data-day="4"]')).to_have_attribute('aria-pressed', 'true')
        passed('weekday controls change visible content and retain keyboard focus')
        page.locator('[data-schedule-mode="week"]').click()
        page.locator('[data-presentation="human"]').click()
        seed(page)
        before = page.evaluate('JSON.stringify(window.PUPLAN_APP.courses())')
        page.locator('#humanWeek [data-course="c1"]').click()
        page.locator('#deleteCourse').click()
        expect(page.locator('#count')).to_have_text('4')
        expect(page.locator('#undoDelete')).to_be_visible()
        page.locator('#undoDelete').click()
        assert page.evaluate('JSON.stringify(window.PUPLAN_APP.courses())') == before
        passed('deletion can be undone without losing course order or content')
        page.locator('#humanWeek [data-course="c1"]').click()
        page.locator('#deleteCourse').click()
        expect(page.locator('#undoDelete')).to_be_visible()
        shot(page, 'undo-mobile')
        updated = [*COURSES[1:], {**COURSES[0], 'id': 'remote-new', 'name': '另一裝置的更新'}]
        page.evaluate('(data)=>window.PUPLAN_APP.setRemoteCourses(data)', updated)
        expect(page.locator('#undoDelete')).to_be_hidden()
        assert page.evaluate("window.PUPLAN_APP.courses().some(c=>c.id==='remote-new')")
        passed('undo is invalidated by a newer remote schedule and cannot roll it back')
        ctx.close()
        for width in [320, 390, 768, 1440]:
            ctx = context(width)
            page = ctx.new_page()
            ready(page)
            shot(page, f'empty-{width}')
            seed(page)
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), f'overflow at {width}'
            shot(page, f'schedule-{width}')
            page.locator('[data-schedule-mode="week"]').click()
            page.locator('[data-presentation="classic"]').click()
            expect(page.locator('#tabs')).to_be_hidden()
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'), f'grid overflow at {width}'
            shot(page, f'grid-{width}')
            passed(f'{width}px empty, list and grid layouts do not overflow the viewport')
            ctx.close()
        ctx = context()
        page = ctx.new_page()
        ready(page, '#friend=' + code)
        expect(page.locator('#friendDialog')).to_be_visible()
        assert page.evaluate('window.PUPLAN_APP.friends().length') == 0
        assert page.evaluate('window.PUPLAN_APP.courses().length') == 0
        page.locator('#friendDialog [data-close]').first.click()
        assert page.evaluate('window.PUPLAN_APP.friends().length') == 0
        passed('opening a share URL requires confirmation and never auto-imports')
        ctx.close()
        ctx = context(390, guest=False)
        page = ctx.new_page()
        ready(page, '#friend=' + code)
        expect(page.locator('#authGate')).not_to_have_class('auth-gate off')
        expect(page.locator('#friendDialog')).to_be_hidden()
        assert page.locator('.shell').evaluate('(el)=>el.inert')
        page.locator('#guestMode').click()
        expect(page.locator('#friendDialog')).to_be_visible()
        assert page.evaluate('window.PUPLAN_APP.friends().length') == 0
        passed('incoming share waits for the account gate rather than bypassing it')
        ctx.close()
        assert not errors, errors
        passed('no uncaught browser exceptions across all exercised journeys')
    except Exception as exc:
        checks.append({'name': 'browser regression', 'passed': False, 'error': str(exc)})
        if page and not page.is_closed():
            shot(page, 'failure')
        raise
    finally:
        (OUT / 'experience-checks.json').write_text(json.dumps({'checks': checks, 'page_errors': errors, 'scope': 'isolated local fixture; external APIs blocked'}, ensure_ascii=False, indent=2))
        browser.close()
        server.shutdown()
