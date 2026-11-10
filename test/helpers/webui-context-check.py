"""Exercise the vendored native tool against owned-chat/provider API doubles."""
import asyncio
import importlib.util
import pathlib
import sys
import tempfile
import types

sys.dont_write_bytecode = True
root = pathlib.Path(sys.argv[1])
with tempfile.TemporaryDirectory() as data:
    def module(name, **values):
        value = types.ModuleType(name)
        value.__dict__.update(values)
        sys.modules[name] = value
    chats = {}
    active = True
    summaries = 0
    async def get_user(user):
        return types.SimpleNamespace(id=user)
    async def owned(chat, user):
        value = chats.get(chat)
        return value if value and value.user_id == user else None
    async def get_chat(chat):
        return chats.get(chat)
    async def running(redis, chat):
        return active
    async def compact(request, user, chat, model, models):
        global summaries
        summaries += 1
        assert user.id == chat.user_id
        chat.chat['history']['messages']['m']['contextSummary'] = {'summary': 'Retained goal and exact SHA'}
        return {'ok': True, 'compacted': True}
    async def usage(chat, model):
        return {'estimated_tokens': 220000, 'model': model}
    module('open_webui.env', DATA_DIR=pathlib.Path(data))
    module('open_webui.models.chats', Chats=types.SimpleNamespace(get_chat_by_id_and_user_id=owned, get_chat_by_id=get_chat))
    module('open_webui.models.users', Users=types.SimpleNamespace(get_user_by_id=get_user))
    module('open_webui.tasks', has_active_tasks=running)
    module('open_webui.utils.context_compaction', compact_chat_branch=compact, get_chat_context_usage=usage)
    spec=importlib.util.spec_from_file_location('native_context', root/'lib/webui-context-tools.py')
    tool=importlib.util.module_from_spec(spec);spec.loader.exec_module(tool);tool._windows={'qwen':262144}
    async def check():
        global active
        chats['one']=types.SimpleNamespace(id='one',user_id='alice',current_message_id='m',chat={'history':{'currentId':'m','messages':{'m':{'model':'qwen'}}}})
        chats['two']=types.SimpleNamespace(id='two',user_id='bob',current_message_id='m',chat={'history':{'messages':{'m':{}}}})
        api=tool.Tools();request=types.SimpleNamespace(app=types.SimpleNamespace(state=types.SimpleNamespace(redis=None,MODELS={})))
        args={'__user__':{'id':'alice'},'__metadata__':{'chat_id':'one','message_id':'m','model':'qwen'},'__request__':request}
        result=await api.context_status(**args);assert result['activeReply'] and result['usage']['model']=='qwen' and result['pressure']['compactionRecommended'] and result['pressure']['contextWindow']==262144
        try:
            await api.context_status(**{**args,'__user__':{'id':'bob'}})
            raise AssertionError('cross-user chat access')
        except ValueError:pass
        first,second=await asyncio.gather(api.context_compact('same','Explicit checkpoint saved',**args),api.context_compact('same','Explicit checkpoint saved',**args))
        assert first.get('replayed') or second.get('replayed')
        assert len(tool._tasks)==1 and summaries==0
        other=await api.context_compact('another','Do not duplicate',**args);assert other['request_id']=='same'
        await api.context_compact_cancel('same',__user__=args['__user__'],__metadata__=args['__metadata__'])
        assert (await api.context_status(**args))['requests']['same']['state']=='cancelled' and summaries==0
        queued=await api.context_compact('complete','Saved source and review ids',**args);assert queued['state']=='queued'
        active=False
        await asyncio.gather(*list(tool._tasks.values()))
        done=await api.context_status(**args);assert done['requests']['complete']['compacted'] and summaries==1
        await api.context_compact('complete','Repeat',**args);assert summaries==1
        active=True
        await api.context_compact('changed','Saved source',**args)
        chats['one'].current_message_id='new-branch';active=False
        await asyncio.gather(*list(tool._tasks.values()))
        assert (await api.context_status(**args))['requests']['changed']['state']=='superseded' and summaries==1
        tool._store_sync('alice','one','reserve','restart',{'state':'queued','createdAt':0,'compacted':False})
        expired=await api.context_status(**args);assert expired['requests']['restart']['state']=='interrupted' and expired['requests']['restart']['compacted'] is None
        # A separately imported worker shares reservations, not process memory.
        second_spec=importlib.util.spec_from_file_location('native_context_worker',root/'lib/webui-context-tools.py')
        worker=importlib.util.module_from_spec(second_spec);second_spec.loader.exec_module(worker)
        assert (await worker._records('alice','one'))['complete']['state']=='done'
        assert not await worker._records('bob','two')
        for n in range(14):
            key='history-'+str(n)
            tool._store_sync('alice','one','reserve',key,{'state':'queued','createdAt':tool.time.time(),'compacted':False})
            await tool._save('alice','one',key,{'state':'compacting'})
            await tool._save('alice','one',key,{'state':'skipped'})
        bounded=await api.context_status(**args)
        assert bounded['requestsTruncated'] and len(bounded['requests'])==12 and bounded['requestCount']>12
        assert (await api.context_compact('complete','Replay older history',**args))['state']=='done' and summaries==1
    asyncio.run(check())
print('owned queue, cancellation, single reservation, native summary, branch pins, restart expiry and cross-worker receipts passed')
