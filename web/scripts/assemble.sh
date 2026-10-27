#!/usr/bin/env bash
# Demo cut: shots/<out> (default demo-v1.mp4; demo-v0.mp4 is the kept fallback), 1920x1080, 30 fps.
# Inputs: recorded clips in shots/ + cards from scripts/cards.mjs.
# Audio: any clip that carries an audio track (voice muxed by record.mjs or later by scripts/mux-voice.mjs) is laid
# onto the timeline at that clip's offset; video is concatenated first and never re-rendered for audio.
#   bash scripts/assemble.sh [demo-v1.mp4]
set -euo pipefail
cd "$(dirname "$0")/../shots"
NAME="${1:-demo-v1.mp4}"
declare -a SRC=()   # per segment: source clip (audio candidate) or empty
T=$(mktemp -d /tmp/pl-cut.XXXX); trap 'rm -rf "$T"' EXIT
ENC=(-r 30 -pix_fmt yuv420p -c:v libx264 -preset medium -crf 20 -an -video_track_timescale 30000)
ff() { ffmpeg -loglevel error -y "$@"; }  # ffmpeg/ffprobe from PATH (brew on macOS)
n=0; seg() { n=$((n+1)); OUT=$(printf '%s/%02d.mp4' "$T" $n); }  # sets OUT (no subshell, so n persists)
clip() { seg; SRC[$n]="$1"; ff -i "$1" -vf "scale=1920:1080,fps=30" "${ENC[@]}" "$OUT"; }
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
ff -f concat -safe 0 -i "$T/list.txt" -c copy "$T/video.mp4"
# timeline + audio lanes: each clip's own audio starts at that clip's offset
t=0; i=0; ains=(); afil=""; k=0
for f in "$T"/[0-9]*.mp4; do
  i=$((i+1)); d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  src="${SRC[$i]:-}"; tag=""
  if [ -n "$src" ] && [ -n "$(ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$src")" ]; then
    k=$((k+1)); ains+=(-i "$src"); ms=$(printf '%.0f' "$(echo "$t*1000" | bc)")
    afil+="[$k:a]atrim=0:$d,adelay=$ms:all=1[a$k];"; tag="  (+audio)"
  fi
  printf '%6.2f  +%5.2f  %s %s%s\n' "$t" "$d" "$(basename "$f")" "${src:-card}" "$tag"; t=$(echo "$t+$d" | bc)
done
if [ "$k" -gt 0 ]; then
  mix=""; for j in $(seq 1 $k); do mix+="[a$j]"; done
  ff -i "$T/video.mp4" "${ains[@]}" -filter_complex "${afil}${mix}amix=inputs=$k:normalize=0:duration=longest[a]" \
    -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -t "$t" -movflags +faststart "$NAME"
else
  ff -i "$T/video.mp4" -c copy -movflags +faststart "$NAME"
fi
echo "$NAME: $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$NAME") s, $(du -h "$NAME" | cut -f1), audio lanes: $k"
