#!/bin/sh
# docs/images/redline.gif, of the frames that shots.spec.ts wrote: each one shown for its
# duration, at 10 frames a second (gifski merges the repeated ones).
set -eu
here=$(cd "$(dirname "$0")" && pwd)
frames=$here/../../test-results/readme-frames
out=$here/../../../../docs/images/redline.gif
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
n=0
while read -r name ms; do
  k=$(((ms + 50) / 100))
  [ "$k" -ge 1 ] || k=1
  while [ "$k" -gt 0 ]; do
    ln -s "$frames/$name" "$tmp/$(printf %05d "$n").png"
    n=$((n + 1))
    k=$((k - 1))
  done
done <"$frames/durations.txt"
gifski --fps 10 --width 1280 --quality 90 -o "$out" "$tmp"/*.png
ls -l "$out"
