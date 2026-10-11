"""Isolated guest regression. No production requests, accounts, or credentials."""
import functools
import http.server
import json
import threading
import traceback
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'product-test-results'
OUT.mkdir(exist_ok=True)
checks=[]
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
URL=f'http://127.0.0.1:{server.server_port}/pu-plan/'
def passed(name):
    checks.append(name)
    print('PASS',name,flush=True)

with sync_playwright() as p:
    browser=p.chromium.launch()
    context=browser.new_context(viewport={'width':1440,'height':1000},locale='zh-TW',timezone_id='Asia/Taipei',service_workers='block')
    context.route('**/*',lambda route: route.continue_() if route.request.url.startswith(URL.rsplit('/pu-plan/',1)[0]+'/') else route.abort())
    context.add_init_script("localStorage.setItem('puplan_guest','1')")
    page=context.new_page()
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_default_timeout(12000)
    page.clock.set_fixed_time('2026-10-12T07:00:00+08:00')
    try:
        page.goto(URL)
        page.wait_for_function('!!window.NOLU_PLANNER')
        expect(page.locator('#authGate')).not_to_be_visible()
        expect(page.locator('.schedule-empty')).to_be_visible()
        assert '先新增' in page.evaluate("NOLU_PLANNER.ask('安排兩小時')")
        passed('empty guest and planner require schedule data')
        page.locator('[data-empty-add]').click()
        page.locator('#courseName').fill('   ')
        page.locator('#saveCourse').click()
        expect(page.locator('#courseError')).to_contain_text('不能只填空白')
        assert page.evaluate('PUPLAN_APP.courses().length')==0
        passed('whitespace-only course is rejected without data mutation')
        page.locator('#courseName').fill('資料庫系統')
        page.locator('#day').select_option('1')
        page.locator('#start').select_option('8')
        assert page.locator('#end').input_value()=='8'
        assert page.locator('#end option[value="7"]').is_disabled()
        page.locator('#start').select_option('1')
        page.locator('#end').select_option('2')
        page.locator('#teacher').fill('測試老師')
        page.locator('#room').fill('主顧 324')
        page.locator('#saveCourse').click()
        expect(page.locator('#courseDialog')).not_to_be_visible()
        expect(page.locator('#count')).to_have_text('1')
        passed('period constraints, save feedback and course counter')
        page.reload();page.wait_for_function('!!window.NOLU_PLANNER')
        expect(page.locator('#count')).to_have_text('1')
        expect(page.locator('#humanWeek')).to_contain_text('資料庫系統')
        passed('guest course persists after a fresh load')
        for _ in range(2):
            page.locator('[data-presentation="classic"]').click()
            expect(page.locator('#classicSchedule')).to_be_visible()
            expect(page.locator('#humanWeek')).not_to_be_visible()
            page.locator('[data-schedule-mode="day"]').click()
            page.locator('[data-day="1"]').click()
            expect(page.locator('#mobile')).to_contain_text('資料庫系統')
            page.locator('[data-presentation="human"]').click()
            expect(page.locator('#humanWeek')).to_be_visible()
            expect(page.locator('#classicSchedule')).not_to_be_visible()
            page.locator('[data-schedule-mode="week"]').click()
        passed('single renderer owns all day/week and card/grid switches')
        page.locator('#humanWeek [data-course]').first.focus()
        page.keyboard.press('Enter')
        expect(page.locator('#courseDialog')).to_be_visible()
        page.locator('#room').fill('主顧 301')
        page.locator('#saveCourse').click()
        expect(page.locator('#humanWeek')).to_contain_text('主顧 301')
        passed('course editing works by keyboard')
        # Fault injection affects only the test browser and only course writes.
        page.locator('#add').click();page.locator('#courseName').fill('不能假裝儲存成功')
        page.locator('#day').select_option('2')
        page.evaluate("""() => {window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='puplan_courses')throw new DOMException('full','QuotaExceededError');return window.originalSetItem.call(this,k,v)}}""")
        page.locator('#saveCourse').click()
        expect(page.locator('#courseError')).to_contain_text('尚未儲存')
        expect(page.locator('#courseDialog')).to_be_visible()
        expect(page.locator('#courseName')).to_have_value('不能假裝儲存成功')
        assert page.evaluate('PUPLAN_APP.courses().length')==1
        page.evaluate('Storage.prototype.setItem=window.originalSetItem')
        page.locator('#courseDialog [data-close]').first.click()
        passed('quota failure preserves draft and never reports success')
        page.evaluate("""() => {PUPLAN_APP.setFriends([{id:'test-friend',name:'測試同學',username:'classmate',courses:[{id:'friend-course',name:'測試課',day:1,start:3,end:5}]}]);PUPLAN_APP.setSelectedFriend('test-friend')}""")
        answer=page.evaluate("NOLU_PLANNER.ask('星期一跟好友找共同空堂')")
        assert '測試同學' in answer and '14:00' in answer and '10:00' not in answer,answer
        page.locator('.nav [data-view="friends"]').click()
        page.locator('[data-friend="test-friend"]').click()
        expect(page.locator('#friendView')).to_contain_text('測試同學')
        passed('friend ID resolves to the actual profile and busy timetable')
        answer=page.evaluate("NOLU_PLANNER.ask('星期一晚上安排兩小時，不要太晚')")
        assert '18:00–20:00' in answer and '120 分鐘' in answer,answer
        assert '週末' in page.evaluate("NOLU_PLANNER.ask('星期六幫我安排兩小時')")
        passed('Chinese duration, exact evening slots and weekend boundaries')
        page.locator('.nav [data-view="ai"]').click()
        page.locator('#aiInput').fill('星期三有什麼課')
        before=page.locator('#aiMessages .bubble').count()
        page.locator('#aiInput').dispatch_event('keydown',{'key':'Enter','isComposing':True,'keyCode':229})
        assert page.locator('#aiMessages .bubble').count()==before
        page.locator('#plannerDay').select_option('一')
        page.locator('#plannerEvening').check();page.locator('#plannerApply').click()
        expect(page.locator('#aiMessages')).to_contain_text('18:00–20:00')
        passed('IME confirmation does not send; structured planner actually applies options')
        page.screenshot(path=str(OUT/'planner-desktop.png'),full_page=True)
        page.locator('.nav [data-view="settings"]').click()
        expect(page.locator('#providerMeshSummary')).to_contain_text('訪客模式')
        expect(page.locator('#providerMeshState')).to_contain_text('沒有啟用跨裝置同步')
        passed('guest mode has local-only backup status, not a cloud outage alarm')
        page.evaluate("""() => {PUPLAN_APP.setCoursesFromUser([{id:'1',name:'資料庫系統',day:1,start:1,end:2,teacher:'林老師',room:'主顧 324',color:'blue'},{id:'2',name:'專題實作',day:1,start:6,end:8,teacher:'王老師',room:'主顧 301',color:'mint'},{id:'3',name:'網路通訊概論',day:2,start:3,end:4,teacher:'張老師',room:'主顧 301',color:'violet'},{id:'4',name:'行動應用開發',day:3,start:6,end:8,teacher:'陳老師',room:'主顧 324',color:'orange'},{id:'5',name:'資訊管理專題',day:5,start:1,end:3,teacher:'李老師',room:'任垣 404',color:'pink'}]);PUPLAN_APP.changeView('schedule')}""")
        page.screenshot(path=str(OUT/'schedule-desktop.png'),full_page=True)
        for width in [320,390,768,1440]:
            page.set_viewport_size({'width':width,'height':900})
            for view in ['schedule','ai','settings','friends']:
                page.evaluate('(v)=>PUPLAN_APP.changeView(v)',view)
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'),(width,view)
                assert page.locator('#title').bounding_box()['width']>0
            page.evaluate("PUPLAN_APP.changeView('schedule')")
            if width==390:
                page.screenshot(path=str(OUT/'schedule-mobile.png'),full_page=True)
                page.evaluate("PUPLAN_APP.changeView('ai')")
                page.screenshot(path=str(OUT/'planner-mobile.png'),full_page=True)
        passed('four page views fit 320, 390, 768 and 1440 pixel viewports')
        # The expected blocked service-worker warning is not a JavaScript exception.
        assert not errors,errors
        passed('no uncaught frontend JavaScript exceptions')
    except Exception:
        page.screenshot(path=str(OUT/'failure.png'),full_page=True)
        (OUT/'failure.txt').write_text(traceback.format_exc()+'\n'+json.dumps(errors,ensure_ascii=False))
        raise
    finally:
        (OUT/'checks.json').write_text(json.dumps({'passed':checks,'page_errors':errors},ensure_ascii=False,indent=2))
        browser.close();server.shutdown()
