"""Real guest journeys against the local app; all external traffic is blocked."""
import functools
import http.server
import json
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
threading.Thread(target=server.serve_forever, daemon=True).start()
ORIGIN = f'http://127.0.0.1:{server.server_port}'
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
            context = browser.new_context(viewport={'width': width, 'height': 900}, locale='zh-TW', timezone_id='Asia/Taipei', service_workers='block')
            context.route('**/*', lambda route: route.continue_() if route.request.url.startswith(ORIGIN + '/') else route.abort())
            page = context.new_page()
            page.set_default_timeout(12000)
            errors = []
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
                page.locator('#saveCourse').click()
                expect(page.locator('#count')).to_have_text('1')
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
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'), 'Horizontal page overflow'
                assert not errors, errors
                passed.append('no horizontal overflow or uncaught exceptions')
                results.append({'browser': engine, 'width': width, 'passed': passed, 'error': None})
            except Exception:
                error = traceback.format_exc()
                page.screenshot(path=str(OUT / f'{key}-failure.png'), full_page=True)
                results.append({'browser': engine, 'width': width, 'passed': passed, 'error': error, 'page_errors': errors})
                print(key, error, flush=True)
            finally:
                context.close()
        browser.close()
server.shutdown()
(OUT / 'guest-journey.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(json.dumps(results, ensure_ascii=False, indent=2))
if any(item['error'] for item in results):
    raise SystemExit(1)
