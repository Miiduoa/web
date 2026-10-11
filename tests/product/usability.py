"""Interaction regressions against the real shell/CSP; OCR output is a local fixture."""
import base64, functools, http.server, json, threading, traceback, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'product-test-results'; OUT.mkdir(exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
checks=[]; errors=[]
def passed(name): checks.append(name); print('PASS',name,flush=True)
def ready(page):
    for _ in range(150):
        if page.evaluate('Boolean(window.NOLU_PLANNER)'): return
        time.sleep(.1)
    raise AssertionError('app did not initialize')
def decide(page,accept=False): page.once('dialog',lambda d:d.accept() if accept else d.dismiss())
with sync_playwright() as p:
    browser=p.chromium.launch()
    context=browser.new_context(viewport={'width':390,'height':844},locale='zh-TW',timezone_id='Asia/Taipei',service_workers='block',accept_downloads=True)
    context.route('**/*',lambda r:r.continue_() if r.request.url.startswith(origin+'/') else r.abort())
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.set_default_timeout(12000)
    try:
        page.goto(origin+'/pu-plan/'); ready(page)
        expect(page.locator('#authGate')).to_be_visible()
        assert page.locator('.shell').evaluate('(e)=>e.inert')
        page.locator('#regPassword').fill('not-a-real-password')
        page.locator('[aria-controls="regPassword"]').click()
        expect(page.locator('#regPassword')).to_have_attribute('type','text')
        page.locator('[aria-controls="regPassword"]').click()
        expect(page.locator('#regPassword')).to_have_attribute('type','password')
        page.screenshot(path=str(OUT/'usability-auth-mobile.png'),full_page=True)
        passed('auth overlay blocks background controls and password visibility is explicit')
        page.locator('#guestMode').click();expect(page.locator('#authGate')).not_to_be_visible()
        assert not page.locator('.shell').evaluate('(e)=>e.inert')
        page.screenshot(path=str(OUT/'usability-empty-mobile.png'),full_page=True)
        page.locator('#mobileAdd').click();page.locator('#courseName').fill('未儲存的課')
        decide(page);page.locator('#courseDialog [data-close]').first.click()
        expect(page.locator('#courseDialog')).to_be_visible();expect(page.locator('#courseName')).to_have_value('未儲存的課')
        decide(page);page.keyboard.press('Escape');expect(page.locator('#courseDialog')).to_be_visible()
        decide(page,True);page.locator('#courseDialog [data-close]').first.click()
        assert page.evaluate('PUPLAN_APP.courses().length')==0
        passed('cancel and Escape preserve the draft until discard is confirmed')
        page.locator('#mobileAdd').click();page.locator('#courseName').fill('資料庫系統')
        page.locator('#day').select_option('1');page.locator('#start').select_option('1');page.locator('#end').select_option('2')
        page.locator('#saveCourse').click()
        page.locator('#humanWeek [data-course]').first.click();page.locator('#room').fill('本機尚未送出的修改')
        page.evaluate("PUPLAN_APP.setCoursesFromUser(PUPLAN_APP.courses().map(c=>({...c,room:'另一裝置的新教室'})))")
        page.locator('#saveCourse').click();expect(page.locator('#courseError')).to_contain_text('課表已')
        assert page.evaluate('PUPLAN_APP.courses()[0].room')=='另一裝置的新教室'
        page.screenshot(path=str(OUT/'usability-conflict-mobile.png'),full_page=True)
        decide(page,True);page.locator('#courseDialog [data-close]').first.click()
        passed('stale edits cannot overwrite updated timetable data')
        page.locator('.bottom [data-view="settings"]').click()
        assert page.locator('.bottom [data-view="settings"]').get_attribute('aria-current')=='page'
        warnings=[]
        page.once('dialog',lambda d:(warnings.append(d.message),d.dismiss()))
        page.locator('#copyLink').click();assert '無法撤回' in warnings[0]
        passed('sharing requires explicit acknowledgement of readable, nonrevocable copies')
        with page.expect_download() as download_info: page.locator('#downloadSchedule').click()
        download=download_info.value;download.save_as(str(OUT/'test-schedule-backup.json'))
        backup=json.loads((OUT/'test-schedule-backup.json').read_text())
        assert set(backup)=={'format','version','exportedAt','courses','meta'}
        assert len(backup['courses'])==1 and 'session' not in json.dumps(backup)
        malformed={'name':'bad.json','mimeType':'application/json','buffer':b'{broken'}
        page.locator('#backupInput').set_input_files(malformed);expect(page.locator('#backupStatus')).to_contain_text('不是可讀取')
        new={'format':'nolu-schedule','version':1,'courses':[{'id':'new','name':'備份裡的課','day':2,'start':4,'end':5}]}
        decide(page,True);page.locator('#backupInput').set_input_files({'name':'course.json','mimeType':'application/json','buffer':json.dumps(new).encode()})
        expect(page.locator('#backupStatus')).to_contain_text('已合併 1 門')
        page.locator('#backupInput').set_input_files({'name':'course.json','mimeType':'application/json','buffer':json.dumps(new).encode()})
        expect(page.locator('#backupStatus')).to_contain_text('沒有重複新增')
        assert page.evaluate('PUPLAN_APP.courses().length')==2
        passed('backup download contains only timetable data; restore rejects corruption and deduplicates')
        page.locator('.bottom [data-view="schedule"]').click()
        saved_courses = page.evaluate('PUPLAN_APP.courses()')
        page.evaluate('PUPLAN_APP.setRemoteCourses([])')
        expect(page.locator('.hero-side')).not_to_be_visible()
        page.evaluate('(courses)=>PUPLAN_APP.setRemoteCourses(courses)', saved_courses)
        expect(page.locator('.hero-side')).to_be_visible()
        passed('remote schedule renders update the empty state without a user-edit event')
        page.locator('#importSchedule').click()
        assert page.locator('input[name="importMode"][value="merge"]').is_checked()
        # Synthetic grid and controlled OCR results: no external model, uploads or personal data.
        data=page.evaluate("""() => {const c=document.createElement('canvas');c.width=1700;c.height=1450;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,c.width,c.height);x.strokeStyle='black';x.lineWidth=3;for(let i=0;i<9;i++){x.beginPath();x.moveTo(20+i*200,100);x.lineTo(20+i*200,1300);x.stroke()}for(let i=0;i<16;i++){x.beginPath();x.moveTo(20,100+i*80);x.lineTo(1620,100+i*80);x.stroke()}window.__ocrResolvers=[];window.Tesseract={OEM:{LSTM_ONLY:1},PSM:{SPARSE_TEXT:11},createWorker:async()=>({setParameters:async()=>{},recognize:()=>new Promise(resolve=>window.__ocrResolvers.push(()=>resolve({data:{text:'測試課表',blocks:[{paragraphs:[{lines:[{text:'匯入的新課 / 林老師',confidence:90,bbox:{x0:240,y0:190,x1:380,y1:220}}]}]}]}})))})};return c.toDataURL('image/png').split(',')[1]}""")
        fixture={'name':'fixture.png','mimeType':'image/png','buffer':base64.b64decode(data)}
        page.locator('#scheduleImageInput').set_input_files(fixture)
        for _ in range(100):
            if page.evaluate('__ocrResolvers.length')==1:break
            time.sleep(.05)
        assert page.evaluate('__ocrResolvers.length')==1
        page.locator('#scheduleImageInput').set_input_files(fixture)
        page.evaluate('__ocrResolvers[0]()')
        for _ in range(100):
            if page.evaluate('__ocrResolvers.length')==2:break
            time.sleep(.05)
        assert page.evaluate('__ocrResolvers.length')==2
        page.evaluate('__ocrResolvers[1]()');expect(page.locator('#importResults')).to_be_visible()
        page.wait_for_timeout(300)
        assert page.evaluate('__ocrResolvers.length')==2, 'a settled image must not start a duplicate OCR job'
        passed('changing images during OCR starts the newest job instead of leaving import stuck')
        page.locator('input[name="importMode"][value="replace"]').check()
        decide(page);page.locator('#confirmImport').click();assert page.evaluate('PUPLAN_APP.courses().length')==2
        decide(page,True);page.locator('#confirmImport').click()
        expect(page.locator('#importDialog')).not_to_be_visible();assert page.evaluate('PUPLAN_APP.courses().length')==1
        assert page.evaluate('PUPLAN_APP.courses()[0].name')=='匯入的新課'
        passed('replacement cancellation preserves originals; confirmation applies the preview')
        for width in [320,390,768,1440]:
            page.set_viewport_size({'width':width,'height':900})
            page.evaluate("PUPLAN_APP.changeView('schedule')")
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            if width<=768:
                for box in page.locator('.bottom button').all():
                    assert box.bounding_box()['width']>=40 and box.bounding_box()['height']>=44
            page.evaluate("document.querySelector('#add').click()")
            expect(page.locator('#courseDialog')).to_be_visible()
            assert page.locator('#saveCourse').is_visible()
            page.screenshot(path=str(OUT/f'usability-editor-{width}.png'),full_page=True)
            page.locator('#courseDialog [data-close]').first.click()
        passed('responsive controls and dialogs fit 320, 390, 768 and 1440 pixel layouts')
        assert not errors,errors;passed('no uncaught JavaScript errors in new workflows')
    except Exception:
        page.screenshot(path=str(OUT/'usability-failure.png'),full_page=True)
        (OUT/'usability-failure.txt').write_text(traceback.format_exc()+'\n'+json.dumps(errors,ensure_ascii=False))
        raise
    finally:
        (OUT/'usability-checks.json').write_text(json.dumps({'passed':checks,'page_errors':errors},ensure_ascii=False,indent=2))
        browser.close();server.shutdown()
