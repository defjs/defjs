#!/usr/bin/env python3
"""Summarize a V8 .cpuprofile of a bun-built bundle: self/inclusive time per function and per source module."""
import bisect
import collections
import json
import re
import sys

prof_path, bundle_path = sys.argv[1], sys.argv[2]
top = int(sys.argv[3]) if len(sys.argv) > 3 else 30
bundle_name = bundle_path.split('/')[-1]

# bun build writes a `// path/to/module.ts` marker before each module.
markers = []
for index, line in enumerate(open(bundle_path)):
    match = re.match(r'^// .*?(src/.*\.ts|[^/]*\.m?[jt]s)$', line.rstrip())
    if match:
        markers.append((index, match.group(1)))
starts = [marker[0] for marker in markers]


def module_of(frame):
    url = frame['url']
    if bundle_name not in url:
        if not url:
            return '(native/vm)'
        return 'node:' + url.split('/')[-1] if url.startswith('node:') else url.split('/')[-1]
    position = bisect.bisect_right(starts, frame['lineNumber']) - 1
    return markers[position][1] if position >= 0 else 'bench'


profile = json.load(open(prof_path))
nodes = {node['id']: node for node in profile['nodes']}
parent = {child: node['id'] for node in profile['nodes'] for child in node.get('children', [])}
spent = collections.Counter()
for sample, delta in zip(profile['samples'], profile['timeDeltas']):
    spent[sample] += delta
total = sum(spent.values())


def key(node):
    frame = node['callFrame']
    return f"{frame['functionName'] or '(anonymous)'} [{module_of(frame)}]"


self_time, inclusive, by_module = collections.Counter(), collections.Counter(), collections.Counter()
for node_id, delta in spent.items():
    node = nodes[node_id]
    self_time[key(node)] += delta
    by_module[module_of(node['callFrame'])] += delta
    seen, cursor = set(), node_id
    while cursor is not None:
        name = key(nodes[cursor])
        if name not in seen:
            inclusive[name] += delta
            seen.add(name)
        cursor = parent.get(cursor)

print(f'total {total / 1000:.0f} ms')
print('\n## self time')
for name, value in self_time.most_common(top):
    print(f'{value / total * 100:6.2f}%  {name}')
print('\n## inclusive time (library)')
for name, value in sorted(((n, v) for n, v in inclusive.items() if 'src/' in n), key=lambda item: -item[1])[:top]:
    print(f'{value / total * 100:6.2f}%  {name}')
print('\n## self time by module')
for name, value in by_module.most_common(20):
    print(f'{value / total * 100:6.2f}%  {name}')
