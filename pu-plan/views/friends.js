export function friendsView(){return `
<section class="view" id="friends">
  <div class="section-head"><div><h2>找人</h2><p>搜名字或 @帳號，點一下就能看個人頁。成為好友後才能互看私人內容和課表。</p></div><button class="btn lime" id="addFriend">找人</button></div>
  <div class="social-highlights" id="socialHighlights"></div>
  <div class="friend-layout">
    <aside class="panel friend-side"><input class="search" id="cloudFriendSearch" placeholder="搜尋名字或 @帳號"><div class="search-results" id="cloudSearchResults"></div><div class="friend-divider"></div><div id="requestList" class="request-list"><small>登入後會顯示好友邀請</small></div><div class="friend-divider"></div><div id="meetupList" class="meetup-list"><small>有共同空堂時，可以直接約吃飯或讀書。</small></div><div class="friend-divider"></div><input class="search small-search" id="search" placeholder="找我的好友"><div id="friendList"></div></aside>
    <div class="friend-main"><div class="friend-tools" id="friendTools"><button class="on" data-friend-tool="profile">個人頁</button><button data-friend-tool="same-building">今天附近</button><button data-friend-tool="overlay">一起看課表</button><button data-friend-tool="meetups">邀約</button></div><div class="panel" id="friendView"><div class="empty">先找一個人看看。</div></div></div>
  </div>
</section>`}
