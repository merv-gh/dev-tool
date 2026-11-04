"""Opt-in MCP smoke test against the installed code-review-graph package.
Run with uv run --python 3.12 --with code-review-graph==2.3.9 python dev/check-code-review-graph.py.
Uses disposable service sources and an isolated home; never touches registered user repos.
"""
import asyncio
import json
import os
from pathlib import Path
import shutil
import tempfile
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


def unpack(result):
    if result.isError:
        raise AssertionError(str(result.content))
    for block in result.content:
        if getattr(block, 'type', '') == 'text':
            try:
                return json.loads(block.text)
            except json.JSONDecodeError:
                pass
    raise AssertionError('No JSON tool result')


async def run():
    with tempfile.TemporaryDirectory(prefix='dt-graph-mcp-') as temporary:
        home = Path(temporary)
        service = home / 'payments-service'
        shutil.copytree(Path(__file__).resolve().parent.parent / 'test/fixtures/payments-service', service)
        (service / '.code-review-graph').mkdir()
        other = home / 'other-service'
        other.mkdir()
        (other / '.code-review-graph').mkdir()
        (other / 'Noise.java').write_text('class Noise { int unrelated() { return 0; } }')
        env = dict(os.environ, HOME=str(home), GIT_CEILING_DIRECTORIES=str(home))
        params = StdioServerParameters(command='code-review-graph', args=['serve', '--repo', str(service)], env=env)
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                tools = await session.list_tools()
                names = [tool.name for tool in tools.tools]
                for name in ['build_or_update_graph_tool', 'query_graph_tool', 'get_impact_radius_tool']:
                    assert name in names, name
                calls = []
                async def call(name, args, statuses=('ok',)):
                    value = unpack(await session.call_tool(name, args))
                    calls.append({'tool': name, 'arguments': {k: ('payments-service' if v == str(service) else 'other-service' if v == str(other) else v) for k, v in args.items()}, 'result': value})
                    assert value.get('status') in statuses, value
                    return value
                built = await call('build_or_update_graph_tool', {'repo_root': str(service), 'full_rebuild': True, 'postprocess': 'minimal'})
                assert built.get('total_nodes', 0) > 10, built
                await call('build_or_update_graph_tool', {'repo_root': str(other), 'full_rebuild': True, 'postprocess': 'minimal'})
                ambiguous = await call('query_graph_tool', {'repo_root': str(service), 'pattern': 'callers_of', 'target': 'fee'}, ('ambiguous',))
                exact = next(n['qualified_name'] for n in ambiguous['candidates'] if n['kind'] == 'Function' and n['name'] == 'fee' and n['parent_name'] == 'FeeCalculator')
                queried = await call('query_graph_tool', {'repo_root': str(service), 'pattern': 'callers_of', 'target': exact})
                assert queried.get('result_count') == 1 and queried['results'][0]['parent_name'] == 'PaymentService', queried
                isolated = await call('query_graph_tool', {'repo_root': str(other), 'pattern': 'callers_of', 'target': 'fee'}, ('ok', 'not_found'))
                assert 'PaymentService' not in json.dumps(isolated), isolated
                impact = await call('get_impact_radius_tool', {'repo_root': str(service), 'changed_files': ['src/main/java/com/acme/pay/FeeCalculator.java'], 'max_depth': 3, 'max_results': 100})
                assert impact.get('changed_nodes'), impact
                semantic_impact = any(n.get('parent_name') == 'PaymentService' for n in impact.get('impacted_nodes', []))
                limitations = [] if semantic_impact else ['Java caller site was found but unresolved; external impact did not reach PaymentService. Use native impact and inspect unresolved_call_sites.']
                print(json.dumps({'tools': names, 'calls': calls, 'checks': 7, 'passed': True, 'semanticImpactVerified': semantic_impact, 'limitations': limitations}, indent=2))


if __name__ == '__main__':
    asyncio.run(run())
