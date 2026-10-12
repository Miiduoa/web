"""Real guest journeys against the local app; all external traffic is blocked."""
import functools
import http.server
import json
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

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=str(ROOT)))
# Mirror production HTTPS rather than deleting upgrade-insecure-requests from CSP.
cert_dir = tempfile.TemporaryDirectory()
cert = Path(cert_dir.name) / 'cert.pem'
keyfile = Path(cert_dir.name) / 'key.pem'
subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', str(keyfile), '-out', str(cert)], check=True, capture_output=True)
tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
tls.load_cert_chain(cert, keyfile)
server.socket = tls.wrap_socket(server.socket, server_side=True)
threading.Thread(target=server.serve_forever, daemon=True).start()
ORIGIN = f'https://127.0.0.1:{server.server_port}'
URL = ORIGIN + '/pu-plan/'
results = []

def ready(page):
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if page.evaluate('Boolean(window.NOLU_PLANNER && window.PUPLAN_AUTH)'):
            return
        time.sleep(.1)
    raise AssertionError('Application did not initialize')

def workspace(page):
    return page.evaluate("JSON.stringify([PUPLAN_APP.courses(), PUPLAN_APP.scheduleMeta()])")

with sync_playwright() as playwright:
    for engine in ['chromium', 'webkit']:
        browser = getattr(playwright, engine).launch()
        for width in [390, 1440]:
            key = f'{engine}-{width}'
            context = browser.new_context(viewport={'width': width, 'height': 900}, locale='zh-TW', timezone_id='Asia/Taipei', service_workers='block', ignore_https_errors=True)
            network = {'mode': 'block', 'calls': 0, 'pending': []}
            def isolate(route):
                request = route.request
                if request.url.startswith(ORIGIN + '/'):
                    return route.continue_()
                try:
                    data = request.post_data_json or {}
                except Exception:
                    data = {}
                headers = {'Content-Type':'application/json','Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST,OPTIONS'}
                if request.method == 'OPTIONS':
                    return route.fulfill(status=204, headers=headers)
                if data.get('action') == 'login':
                    network['calls'] += 1
                    if network['mode'] == 'reject':
                        return route.fulfill(status=400, headers=headers, body=json.dumps({'message':'測試：帳密不正確'}))
                    if network['mode'] == 'hold':
                        network['pending'].append(route)
                        return
                route.abort()
            context.route('**/*', isolate)
            page = context.new_page()
            page.set_default_timeout(12000)
            errors = []
            diagnostics = []
            page.on('console', lambda message: diagnostics.append({'type': message.type, 'text': message.text}))
            page.on('requestfailed', lambda request: diagnostics.append({'failed_url': request.url, 'error': request.failure}))
            page.on('pageerror', lambda error: errors.append(str(error)))
            passed = []
            try:
                page.goto(URL)
                ready(page)
                page.screenshot(path=str(OUT / f'{key}-entry.png'), full_page=True)
                page.locator('#guestMode').click()
                expect(page.locator('#authGate')).not_to_be_visible()
                page.locator('[data-empty-add]').click()
                page.locator('#courseName').fill('資料庫系統')
                page.locator('#day').select_option('1')
                page.locator('#start').select_option('1')
                page.locator('#end').select_option('2')
                page.locator('#teacher').fill('林老師')
                page.locator('#room').fill('主顧 324')
                expect(page.locator('#coursePreview')).to_contain_text('08:10–10:00')
                expect(page.locator('#coursePreview')).to_contain_text('目前課表沒有重疊課程')
                page.locator('#saveCourse').click()
                expect(page.locator('#count')).to_have_text('1')
                page.evaluate("PUPLAN_APP.setScheduleMetaFromUser({year:'115',semester:'1',school:'測試學校'})")
                before = workspace(page)
                passed.append('add course through the guest UI')
                page.screenshot(path=str(OUT / f'{key}-schedule.png'), full_page=True)
                page.locator('#accountChip').click()
                expect(page.locator('#authGate')).to_be_visible()
                assert workspace(page) == before, 'Opening sign-in changed the guest workspace'
                page.locator('#guestMode').click()
                expect(page.locator('#authGate')).not_to_be_visible()
                assert workspace(page) == before, 'Returning from sign-in erased guest courses'
                passed.append('returning from sign-in preserves the same guest workspace')
                page.reload()
                ready(page)
                assert workspace(page) == before, 'Reload erased guest courses'
                expect(page.locator('#authGate')).not_to_be_visible()
                passed.append('guest workspace survives reload')
                page.locator('#accountChip').click()
                page.reload()
                ready(page)
                if page.locator('#authGate').is_visible():
                    page.locator('#guestMode').click()
                assert workspace(page) == before, 'Reload while sign-in was open erased guest courses'
                passed.append('opening sign-in is not an identity transition, including reload')
                page.locator('#accountChip').click()
                expect(page.locator('#guestWorkspaceNotice')).to_be_visible()
                expect(page.locator('#guestMode')).to_have_text('返回我的課表')
                first = page.locator('#guestWorkspaceBackup')
                first.focus()
                page.keyboard.press('Shift+Tab')
                expect(page.locator('#guestMode')).to_be_focused()
                page.keyboard.press('Tab')
                expect(first).to_be_focused()
                page.keyboard.press('Escape')
                expect(page.locator('#authGate')).not_to_be_visible()
                expect(page.locator('#accountChip')).to_be_focused()
                assert workspace(page) == before
                passed.append('guest return by Escape retains work and restores focus')
                page.locator('#accountChip').click()
                page.locator('#loginEmail').fill('guest-test@example.invalid')
                page.locator('#loginPassword').fill('fixture-password')
                # Exercise the real transport stack; only the network response is a fixture.
                network['mode']='reject'
                page.once('dialog', lambda dialog: dialog.accept())
                page.locator('#loginForm .auth-submit').click()
                expect(page.locator('#authStatus')).to_contain_text('測試：帳密不正確')
                expect(page.locator('#loginForm .auth-submit')).to_be_enabled(timeout=2000)
                expect(page.locator('#loginPassword')).to_have_value('fixture-password')
                assert workspace(page) == before
                passed.append('failed login releases controls immediately without erasing guest work')
                network['mode']='hold'
                network['calls']=0
                page.once('dialog', lambda dialog: dialog.accept())
                page.locator('#loginForm .auth-submit').click()
                expect(page.locator('#loginForm .auth-submit')).to_be_disabled()
                page.locator('#loginForm').dispatch_event('submit')
                for _ in range(30):
                    if network['pending']:
                        break
                    page.wait_for_timeout(50)
                assert network['calls'] == 1, 'Duplicate login request'
                assert network['pending'], 'No pending network request was captured'
                page.locator('#guestMode').click()
                for pending in network['pending']:
                    pending.fulfill(status=200, headers={'Content-Type':'application/json','Access-Control-Allow-Origin':ORIGIN}, body=json.dumps({'token':'fixture.signature','portable_token':'fixture.payload.signature','profile':{'id':'11111111-1111-4111-8111-111111111111','display_name':'Do not apply'},'courses':[]}))
                network['pending'].clear()
                network['mode']='block'
                page.wait_for_timeout(150)
                assert page.evaluate("['puplan_session','puplan_session_primary_v1','puplan_session_standby_v1','puplan_portable_session_v1','puplan_course_owner'].every(key=>localStorage.getItem(key)===null)"), 'A late response stored account credentials or ownership'
                page.reload()
                ready(page)
                assert workspace(page) == before
                expect(page.locator('#authGate')).not_to_be_visible()
                passed.append('cancelling a pending login ignores its late response and blocks duplicate requests')
                page.locator('#humanWeek [data-course]').first.click()
                expect(page.locator('#coursePreview')).to_contain_text('目前課表沒有重疊課程')
                page.locator('#courseDialog [data-close]').first.click()
                page.evaluate('window.scrollTo(0,0)')
                course_y = page.locator('#humanWeek [data-course]').first.bounding_box()['y']
                if width == 390:
                    assert course_y < 480, f'First course pushed below the useful viewport: {course_y}'
                page.screenshot(path=str(OUT / f'{key}-refined-schedule.png'), full_page=True)
                for test_width in [320,390,768,1440]:
                    page.set_viewport_size({'width':test_width,'height':900})
                    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), f'Horizontal page overflow at {test_width}'
                passed.append('course placement and responsive layout remain usable from 320 to 1440 pixels')
                assert not errors, errors
                passed.append('no horizontal overflow or uncaught exceptions')
                results.append({'browser': engine, 'width': width, 'passed': passed, 'error': None})
            except Exception:
                error = traceback.format_exc()
                page.screenshot(path=str(OUT / f'{key}-failure.png'), full_page=True)
                results.append({'browser': engine, 'width': width, 'passed': passed, 'error': error, 'page_errors': errors, 'diagnostics': diagnostics})
                print(key, error, flush=True)
            finally:
                context.close()
        browser.close()
server.shutdown()
(OUT / 'guest-journey.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(json.dumps(results, ensure_ascii=False, indent=2))
if any(item['error'] for item in results):
    raise SystemExit(1)
