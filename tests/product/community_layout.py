"""Render the real social components with large image fixtures; no live accounts.
HTTPS keeps the production CSP intact. Only the in-memory signed-in UI boundary
is substituted; social responses and media are intercepted before any network IO.
"""
import base64
import functools
import http.server
import json
import os
import ssl
import struct
import subprocess
import tempfile
import threading
import traceback
import zlib
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'product-test-results'
OUT.mkdir(exist_ok=True)
ENGINE = os.environ.get('NOLU_BROWSER', 'chromium')

def png(width, height, rgb):
    def chunk(kind, value):
        return struct.pack('!I', len(value)) + kind + value + struct.pack('!I', zlib.crc32(kind + value) & 0xffffffff)
    rows = (b'\0' + bytes(rgb) * width) * height
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', width, height, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b'')

def avatar(width, height, rgb):
    return 'data:image/png;base64,' + base64.b64encode(png(width, height, rgb)).decode()

ME = dict(id='11111111-1111-4111-8111-111111111111', display_name='林同學', username='lin_student', avatar_data=avatar(512,512,[98,118,94]))
OTHER = dict(id='22222222-2222-4222-8222-222222222222', display_name='陳同學', username='chen_student', avatar_data=avatar(512,128,[139,150,120]))
EMPTY = dict(id='33333333-3333-4333-8333-333333333333', display_name='沒有頭像的同學', username='new_student', avatar_data='')
REPLY = dict(id=ME['id'], display_name='林同學', username='lin_student', avatar_data=avatar(128,512,[125,145,111]))
MEDIA = 'https://hrrmkrayvrgnwcroyttp.supabase.co/storage/v1/object/sign/puplan-media/fixture.png?token=local-fixture'
POSTS = [
    dict(id='post-self', author=ME, author_id=ME['id'], body='早安。今天先把資料庫專題整理完，再去圖書館。', visibility='private', created_at='2026-10-12T00:30:00Z', like_count=2, reply_count=1,
         replies=[dict(id='reply-self',author=REPLY,author_id=ME['id'],body='一起加油，下午見！',created_at='2026-10-12T00:40:00Z',can_edit=True)]),
    dict(id='post-friend', author=OTHER, author_id=OTHER['id'], body='整理了一下這週的安排，留一點時間給自己。', visibility='public', created_at='2026-10-12T00:10:00Z', like_count=5, reply_count=0, media=[dict(type='image',url=MEDIA)]),
    dict(id='post-long', author={**EMPTY,'display_name':'很長的顯示名稱也不能把貼文操作推到畫面外面'}, author_id=EMPTY['id'], body='長文字測試。'+'資料庫與網路課程。'*45+'<img src=x onerror="window.badImage=1">', visibility='public', created_at='2026-10-11T00:30:00Z', like_count=0, reply_count=0)
]

class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
cert_dir = tempfile.TemporaryDirectory()
cert, key = Path(cert_dir.name)/'cert.pem', Path(cert_dir.name)/'key.pem'
subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost','-keyout',str(key),'-out',str(cert)],check=True,capture_output=True)
tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
tls.load_cert_chain(cert,key)
server.socket = tls.wrap_socket(server.socket,server_side=True)
threading.Thread(target=server.serve_forever,daemon=True).start()
ORIGIN = f'https://127.0.0.1:{server.server_port}'
checks, errors, calls = [], [], []

def passed(text):
    checks.append(text)
    print('PASS:',text,flush=True)

with sync_playwright() as p:
    browser = getattr(p,ENGINE).launch()
    ctx = browser.new_context(viewport={'width':1563,'height':946},locale='zh-TW',timezone_id='Asia/Taipei',service_workers='block',ignore_https_errors=True,reduced_motion='reduce')
    ctx.add_init_script("localStorage.setItem('puplan_guest','1');localStorage.setItem('nolu_guest_scope_v1','1')")
    def route_request(route):
        request = route.request
        if request.url.startswith(ORIGIN + '/'):
            return route.continue_()
        headers={'Content-Type':'application/json','Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'POST,OPTIONS'}
        if request.method=='OPTIONS':
            return route.fulfill(status=204,headers=headers)
        if request.url==MEDIA:
            return route.fulfill(status=200,content_type='image/png',body=png(1000,560,[214,221,204]))
        try:
            payload=request.post_data_json or {}
        except Exception:
            payload={}
        action=payload.get('action')
        calls.append(payload)
        if action=='feed':
            data={'posts':POSTS,'next_cursor':None}
        elif action=='inbox':
            data={'conversations':[dict(id='chat-fixture',kind='direct',members=[dict(user_id=ME['id'],profile=ME),dict(user_id=OTHER['id'],profile=OTHER)],last_message=dict(body='下午圖書館見。',created_at='2026-10-12T00:30:00Z'),unread=0)]}
        elif action=='privacy_get':
            data={'profile_visibility':'private'}
        else:
            return route.abort()
        route.fulfill(status=200,headers=headers,body=json.dumps(data,ensure_ascii=False))
    ctx.route('**/*',route_request)
    page=ctx.new_page()
    page.set_default_timeout(10000)
    page.on('pageerror',lambda error:errors.append(str(error)))
    try:
        page.clock.set_fixed_time('2026-10-12T09:00:00+08:00')
        page.goto(ORIGIN+'/pu-plan/')
        for _ in range(150):
            if page.evaluate('Boolean(window.PUPLAN_AUTH && window.PUPLAN_COMMUNITY && window.NOLU_PLANNER)'):
                break
            page.wait_for_timeout(100)
        else:
            raise AssertionError('Application did not initialize')
        # Keep this strictly within the disposable browser; do not introduce a
        # test login route, production bypass, or persistent account credentials.
        page.evaluate("""profile=>{
          PUPLAN_CLOUD.isSignedIn=()=>true;
          PUPLAN_CLOUD.getProfile=()=>profile;
          localStorage.setItem('puplan_session_primary_v1','social-layout-fixture');
          PUPLAN_COMMUNITY.show();
        }""",ME)
        expect(page.locator('#feedList .feed-card')).to_have_count(3)
        expect(page.locator('.feed-mode-bar')).to_be_visible()
        expect(page.locator('#feedList .feed-media img')).to_be_visible()
        # Wait until the large data images have decoded, not merely entered DOM.
        for _ in range(40):
            if page.locator('#community .avatar img').evaluate_all('(images)=>images.every(img=>img.complete&&img.naturalWidth>0)'):
                break
            page.wait_for_timeout(50)
        assert page.locator('#community .avatar img').evaluate_all('(images)=>images.every(img=>img.complete&&img.naturalWidth>0)')
        passed('real social renderer loads owned, friend, fallback-avatar and reply fixtures with decoded images')
        for width in [1563,1280,1920,768,390,320]:
            page.set_viewport_size({'width':width,'height':946 if width>768 else 844})
            for node in page.locator('#community .avatar').all():
                box=node.bounding_box()
                assert box and abs(box['width']-40)<1 and abs(box['height']-40)<1,(width,box)
            reply=page.locator('.reply-avatar').bounding_box()
            assert abs(reply['width']-32)<1 and abs(reply['height']-32)<1
            first=page.locator('[data-post="post-self"]')
            author=first.locator('.feed-author').bounding_box()
            assert author['height']<=85,(width,author)
            info=first.locator('.feed-author>div:nth-child(2)').bounding_box()
            actions=first.locator('.post-owner-actions').bounding_box()
            assert info['x']+info['width']<=actions['x']+1,(width,info,actions)
            for node in first.locator('.feed-actions button,.post-owner-actions button').all():
                box=node.bounding_box();assert box['width']>=44 and box['height']>=44,(width,box)
            for node in page.locator('#community .feed-card').all():
                assert node.evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'),width
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),width
            media=page.locator('.feed-media img').bounding_box()
            assert media['width']>=200,(width,media)
            assert page.evaluate('window.badImage===undefined')
            # All content bands use the same edges; there is no second inner column.
            bands=[page.locator(s).bounding_box() for s in ['#community .community-tabs','.composer-card','.feed-mode-bar','[data-post="post-self"]']]
            assert max(b['x'] for b in bands)-min(b['x'] for b in bands)<2
            assert max(b['width'] for b in bands)-min(b['width'] for b in bands)<2
            passed(f'{width}px: bounded avatars, aligned content, readable media and no overlap/overflow')
        page.set_viewport_size({'width':1563,'height':946})
        page.evaluate('scrollTo(0,0)')
        page.screenshot(path=str(OUT/f'community-{ENGINE}-desktop.png'),full_page=False)
        page.locator('#postInput').fill('切換排序時，保留這份未發佈的內容。')
        page.locator('[data-feed-mode="latest"]').click()
        expect(page.locator('[data-feed-mode="latest"]')).to_have_attribute('aria-pressed','true')
        expect(page.locator('[data-feed-mode="for_you"]')).to_have_attribute('aria-pressed','false')
        expect(page.locator('#postInput')).to_have_value('切換排序時，保留這份未發佈的內容。')
        for _ in range(30):
            if any(c.get('action')=='feed' and c.get('mode')=='latest' for c in calls):break
            page.wait_for_timeout(50)
        assert any(c.get('action')=='feed' and c.get('mode')=='latest' for c in calls)
        assert page.locator('.feed-mode-bar').evaluate('(bar)=>bar.previousElementSibling.classList.contains("composer-card")')
        passed('feed sorting indicates the selected mode, follows the composer and preserves its draft')
        page.locator('[data-feed-mode="for_you"]').click()
        expect(page.locator('[data-feed-mode="for_you"]')).to_have_attribute('aria-pressed','true')
        page.locator('#postInput').fill('')
        page.locator('[data-reply-toggle="post-self"]').click()
        expect(page.locator('[data-reply-box="post-self"]')).to_be_visible()
        page.locator('[data-edit-reply="reply-self"]').click()
        expect(page.locator('.reply-inline-editor textarea')).to_be_visible()
        page.locator('.reply-inline-editor [data-cancel]').click()
        expect(page.locator('.reply-inline-editor')).to_have_count(0)
        passed('existing reply entry and cancel-edit controls remain usable')
        page.locator('[data-community-tab="chat"]').click()
        expect(page.locator('.inbox-item')).to_have_count(1)
        box=page.locator('.inbox-item .avatar').bounding_box()
        assert box and box['width']==38 and box['height']==38,box
        assert page.locator('.chat-layout').evaluate('(el)=>el.scrollWidth<=el.clientWidth+1')
        passed('inbox images have their own 38px contract rather than expanding the chat layout')
        page.locator('[data-community-tab="feed"]').click()
        expect(page.locator('#feedList .feed-card')).to_have_count(3)
        page.set_viewport_size({'width':390,'height':844})
        page.evaluate('scrollTo(0,0)')
        page.screenshot(path=str(OUT/f'community-{ENGINE}-mobile.png'),full_page=True)
        # Leave the mock account boundary before checking the existing timetable.
        page.evaluate("""()=>{
          localStorage.removeItem('puplan_session_primary_v1');
          PUPLAN_CLOUD.isSignedIn=()=>false;
          PUPLAN_CLOUD.getProfile=()=>null;
          PUPLAN_APP.setCoursesFromUser([{id:'course-fixture',name:'資料庫系統',day:1,start:3,end:4}]);
          PUPLAN_APP.changeView('schedule');
        }""")
        page.locator('.direct-grid-entry').click()
        expect(page.locator('#weekScale')).to_be_visible()
        expect(page.locator('[data-week-scale="overview"]')).to_have_attribute('aria-pressed','true')
        expect(page.locator('#grid [data-course="course-fixture"]')).to_be_visible()
        assert page.locator('#grid').evaluate('(el)=>el.scrollWidth<=el.parentElement.clientWidth+1')
        passed('mobile weekly overview and direct-edit controls are still available and fit the viewport')
        assert not errors,errors
        passed('no uncaught exceptions and no real external API writes')
    except Exception:
        page.screenshot(path=str(OUT/f'community-{ENGINE}-failure.png'),full_page=True)
        raise
    finally:
        (OUT/f'community-{ENGINE}-checks.json').write_text(json.dumps({'browser':ENGINE,'passed':checks,'page_errors':errors,'scope':'Real components with synthetic local profile/feed responses, no production accounts'},ensure_ascii=False,indent=2))
        browser.close()
        server.shutdown()
