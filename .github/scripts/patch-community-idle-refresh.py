from pathlib import Path
p=Path('pu-plan/community.js')
s=p.read_text()
old="let currentTab='feed',currentConversation='',inboxData=[],feedData=[],feedCursor=null,selectedMedia=[],pollTimer=null,storageClient=null,inboxInFlight=null,pollFailures=0,lastInboxAt=0;"
new="let currentTab='feed',currentConversation='',inboxData=[],feedData=[],feedCursor=null,selectedMedia=[],pollTimer=null,storageClient=null,inboxInFlight=null,pollFailures=0,lastInboxAt=0,lastConversationRefreshAt=0;"
assert old in s
s=s.replace(old,new,1)
old="""      if(notificationCheck)await maybeNotify(inboxData,previous);renderInbox();
      if(refreshConversation&&currentConversation&&$('#chatPanel'))await openConversation(currentConversation,true);
"""
new="""      if(notificationCheck)await maybeNotify(inboxData,previous);renderInbox();
      if(refreshConversation&&currentConversation&&$('#chatPanel')){
        const before=previous.find(x=>x.id===currentConversation),after=inboxData.find(x=>x.id===currentConversation);
        const changed=(after?.last_message?.created_at||'')!==(before?.last_message?.created_at||'');
        const unread=Number(after?.unread||0)>0;
        if(changed||unread||Date.now()-lastConversationRefreshAt>120000)await openConversation(currentConversation,true);
      }
"""
assert old in s
s=s.replace(old,new,1)
old="currentConversation=id;const unreadBefore=Number(inboxData.find(x=>x.id===id)?.unread||0),data=await request('conversation',{conversation_id:id}),panel=$('#chatPanel');if(!panel)return;"
new="currentConversation=id;const unreadBefore=Number(inboxData.find(x=>x.id===id)?.unread||0),data=await request('conversation',{conversation_id:id}),panel=$('#chatPanel');if(!panel)return;lastConversationRefreshAt=Date.now();"
assert old in s
s=s.replace(old,new,1)
p.write_text(s)
