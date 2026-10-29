#!/usr/bin/env bash
# Reproduces the measurements in ../hotspot-analysis.md. Needs node >= 26 and bun >= 1.4.
#   bench.sh run     <core-src> [scenario...]           time (node + bun) and allocation (node)
#   bench.sh pair    <core-src-A> <core-src-B> [s...]   interleaved A/B ratio (node + bun)
#   bench.sh count   <core-src> [scenario...]           platform primitives per operation (node)
#   bench.sh leak    <core-src>                         heap retained by a shared caller signal (node)
#   bench.sh profile <core-src> <scenario>              node CPU profile, summarized by analyze.py
# <core-src> is a directory holding the core `index.ts`, e.g. packages/core/src.
# net-* scenarios (net-get-small, net-get-list) talk to a loopback node:http server inside the benchmark process. They run only
# when named, and `run --alloc` would count the server's garbage, so read allocation from the in-memory scenarios instead.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
out=${TMPDIR:-/tmp}/defjs-perf-bench
mkdir -p "$out"
cp "$here/net-server.mjs" "$out/"
gen() { sed "s#__CORE__#$(cd "$1" && pwd)/index.ts#" "$here/$2" > "$out/$3"; }
bundle() { bun build "$out/$1" --target=node --outfile="$out/$2" > /dev/null; }

cmd=$1
shift
case $cmd in
  run)
    gen "$1" scenarios.mjs scenarios.gen.mjs && shift
    cp "$here/run.mjs" "$out/" && bundle run.mjs run.bundle.mjs
    echo '== node' && node --expose-gc --max-semi-space-size=512 --min-semi-space-size=512 "$out/run.bundle.mjs" --alloc "$@"
    echo '== bun' && bun "$out/run.mjs" "$@"
    ;;
  pair)
    gen "$1" scenarios.mjs a.gen.mjs && gen "$2" scenarios.mjs b.gen.mjs && shift 2
    cp "$here/pair.mjs" "$out/" && bundle pair.mjs pair.bundle.mjs
    node "$out/pair.bundle.mjs" "$@"
    bun "$out/pair.mjs" "$@"
    ;;
  count)
    gen "$1" scenarios.mjs scenarios.gen.mjs && shift
    bundle scenarios.gen.mjs scenarios.gen.bundle.mjs && cp "$here/count.mjs" "$out/"
    node "$out/count.mjs" "$@"
    ;;
  leak)
    gen "$1" leak.mjs leak.gen.mjs && bundle leak.gen.mjs leak.bundle.mjs
    node --expose-gc "$out/leak.bundle.mjs"
    ;;
  profile)
    gen "$1" scenarios.mjs scenarios.gen.mjs
    cp "$here/run.mjs" "$out/" && bundle run.mjs run.bundle.mjs
    node --cpu-prof --cpu-prof-interval 50 --cpu-prof-dir="$out" --cpu-prof-name="$2.cpuprofile" "$out/run.bundle.mjs" "$2"
    python3 "$here/analyze.py" "$out/$2.cpuprofile" "$out/run.bundle.mjs"
    ;;
  *)
    sed -n '2,8p' "$0"
    exit 1
    ;;
esac
