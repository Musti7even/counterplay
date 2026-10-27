#!/usr/bin/env bash
# Silent draft cut of the demo: shots/demo-v0.mp4 (1920x1080, 30 fps). Inputs: recorded clips in shots/ + cards from scripts/cards.mjs.
set -euo pipefail
cd "$(dirname "$0")/../shots"
T=$(mktemp -d /tmp/pl-cut.XXXX); trap 'rm -rf "$T"' EXIT
ENC=(-r 30 -pix_fmt yuv420p -c:v libx264 -preset medium -crf 20 -an -video_track_timescale 30000)
ff() { /usr/bin/ffmpeg -loglevel error -y "$@"; }
n=0; seg() { n=$((n+1)); OUT=$(printf '%s/%02d.mp4' "$T" $n); }  # sets OUT (no subshell, so n persists)
clip() { seg; ff -i "$1" -vf "scale=1920:1080,fps=30" "${ENC[@]}" "$OUT"; }
still() { # png, seconds, push-in amount
  seg; local f=$(( $(printf '%.0f' "$(echo "$2*30" | bc)") ))
  ff -loop 1 -i "$1" -vf "scale=3840:2160,zoompan=z='1+$3*on/$f':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=$f:s=1920x1080:fps=30,fade=in:0:6,fade=out:st=$(echo "$2-0.2" | bc):d=0.2" -frames:v $f "${ENC[@]}" "$OUT"; }

clip coldopen.mp4                                                        # cold open: the goal, casual broadcast
seg; ff -ss 3.3 -t 2.4 -i coldopen.mp4 -i cards/rewind.png -filter_complex \
  "[0:v]reverse,setpts=PTS/3,hue=s=0.25,colorbalance=bs=0.25:bm=0.1,eq=brightness=-0.06,scale=1920:1080[r];[r][1:v]overlay=0:0,fps=30" \
  "${ENC[@]}" "$OUT"                                                     # branded rewind
still cards/inter-whatif.png 1.5 0.02
clip whatif.mp4
clip lens.mp4
still cards/inter-quad.png 1.5 0.02
clip quad.mp4
still cards/inter-agents.png 1.5 0.02
clip control.mp4
still cards/arch.png 9 0.05
still cards/end.png 4 0.03

for f in "$T"/[0-9]*.mp4; do echo "file '$f'"; done > "$T/list.txt"
ff -f concat -safe 0 -i "$T/list.txt" -c copy -movflags +faststart demo-v0.mp4
t=0; for f in "$T"/[0-9]*.mp4; do d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f"); printf '%6.2f  +%5.2f  %s\n' "$t" "$d" "$(basename "$f")"; t=$(echo "$t+$d" | bc); done
echo "demo-v0.mp4: $(ffprobe -v error -show_entries format=duration -of csv=p=0 demo-v0.mp4) s, $(du -h demo-v0.mp4 | cut -f1)"
