"""Create a reproducible first-minute comparison, without declaring either ASR truth."""
import difflib
import html
import json
import unicodedata
from pathlib import Path

out = Path('artifacts/TE2mcomyNH8/first-minute')
asr = json.loads((out / 'independent-asr.json').read_text(encoding='utf-8'))
raw = json.loads(Path('artifacts/TE2mcomyNH8/TE2mcomyNH8.ja-orig.json3').read_text(encoding='utf-8'))
youtube = []
for event in raw['events']:
    parts = [segment for segment in event.get('segs', [])
             if segment.get('utf8', '').strip()
             and event['tStartMs'] + segment.get('tOffsetMs', 0) < 60000]
    if not parts:
        continue
    youtube.append({
        'start': event['tStartMs'] / 1000,
        'end': min(60, (event['tStartMs'] + event.get('dDurationMs', 0)) / 1000),
        'text': ''.join(segment['utf8'] for segment in parts).strip(),
        'words': [{'start': (event['tStartMs'] + segment.get('tOffsetMs', 0)) / 1000,
                   'text': segment['utf8']} for segment in parts],
    })

def characters(segments):
    chars = []
    positions = []
    for segment in segments:
        for word in segment.get('words') or [{'text': segment['text'], 'start': segment['start']}]:
            for char in unicodedata.normalize('NFKC', word['text']):
                if unicodedata.category(char)[0] in ('P', 'Z') or char.isspace():
                    continue
                chars.append(char)
                positions.append(word['start'])
    return ''.join(chars), positions

yt_text, yt_times = characters(youtube)
asr_text, asr_times = characters(asr['segments'])
matcher = difflib.SequenceMatcher(None, yt_text, asr_text, autojunk=False)
differences = []
for operation, a0, a1, b0, b1 in matcher.get_opcodes():
    if operation == 'equal':
        continue
    yt_time = yt_times[min(a0, len(yt_times) - 1)]
    asr_time = asr_times[min(b0, len(asr_times) - 1)]
    differences.append({
        'operation': operation, 'youtube': yt_text[a0:a1], 'independent_asr': asr_text[b0:b1],
        'youtube_start': round(yt_time, 3), 'asr_start': round(asr_time, 3),
        'youtube_context': yt_text[max(0, a0 - 14):min(len(yt_text), a1 + 14)],
        'asr_context': asr_text[max(0, b0 - 14):min(len(asr_text), b1 + 14)],
        'review_start': max(0, min(yt_time, asr_time) - 2),
        'near_cut_boundary': max(yt_time, asr_time) >= 57,
        'status': 'needs-audio-review',
    })

result = {
    'experiment': 'TE2mcomyNH8 / 0–60 seconds',
    'normalization': 'NFKC; punctuation and whitespace ignored; spelling and kanji retained.',
    'human_reference_available': False,
    'character_alignment_similarity': round(matcher.ratio(), 4),
    'similarity_is_not_accuracy': True,
    'difference_groups': len(differences),
    'differences': differences,
}
(out / 'youtube-0-60.json').write_text(json.dumps({'source': 'original Japanese automatic captions', 'segments': youtube}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(out / 'youtube-0-60.txt').write_text('\n'.join(segment['text'] for segment in youtube) + '\n', encoding='utf-8')
(out / 'comparison.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def clock(seconds):
    minutes, secs = divmod(seconds, 60)
    return f'{int(minutes):02}:{secs:06.3f}'

def timestamp(seconds):
    value = round(seconds * 1000)
    return f'{value // 3600000:02}:{value // 60000 % 60:02}:{value // 1000 % 60:02},{value % 1000:03}'

(out / 'independent-asr.srt').write_text('\n\n'.join(
    f'{index + 1}\n{timestamp(segment["start"])} --> {timestamp(min(60, segment["end"]))}\n{segment["text"].strip()}'
    for index, segment in enumerate(asr['segments'])) + '\n', encoding='utf-8')

lines = [
    '# 前一分鐘：YouTube 與獨立語音辨識比較', '',
    f'- 音訊：0–60 秒；模型：{asr["metadata"]["model"]}／faster-whisper。',
    '- 第二份辨識稿只使用音訊，沒有使用 YouTube 字幕作為提示。',
    '- 原始字幕與獨立辨識稿保留。此報告列出原始差異；App 採用狀態見 README.md。',
    '- 沒有人工逐字參考稿，因此不能計算或宣稱哪份稿的準確率較高。',
    f'- 忽略標點、空白並使用 NFKC 後，字元對齊相似度為 {matcher.ratio():.1%}，有 {len(differences)} 組差異；這不是辨識準確率。',
    '- 57 秒後的差異可能受 60 秒切段影響。時間僅為模型或字幕提供的近似位置。', '',
    '## 差異', '', '| 約略位置 | YouTube 原文 | 獨立辨識 | 狀態 |', '|---|---|---|---|',
]
for difference in differences:
    lines.append(f'| {clock(difference["youtube_start"])} | {difference["youtube"] or "（無）"} | {difference["independent_asr"] or "（無）"} | {"切段邊界／" if difference["near_cut_boundary"] else ""}待確認 |')
for title, segments in [('YouTube 字幕', youtube), ('獨立辨識稿', asr['segments'])]:
    lines += ['', f'## {title}', '']
    lines += [f'- {clock(segment["start"])}–{clock(segment["end"])}：{segment["text"]}' for segment in segments]
(out / 'comparison.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')

def segment_html(segments):
    return ''.join(f'<button class="passage" data-time="{segment["start"]}"><time>{clock(segment["start"])}</time><span lang="ja">{html.escape(segment["text"])}</span></button>' for segment in segments)

rows = ''.join(f'<tr><td><button data-time="{difference["review_start"]}">▶ {clock(difference["youtube_start"])}</button></td><td lang="ja">{html.escape(difference["youtube"] or "（無）")}<small>{html.escape(difference["youtube_context"])}</small></td><td lang="ja">{html.escape(difference["independent_asr"] or "（無）")}<small>{html.escape(difference["asr_context"])}</small></td><td>待確認{" · 切段邊界" if difference["near_cut_boundary"] else ""}</td></tr>' for difference in differences)
page = '''<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>前一分鐘字幕比較</title><style>
*{box-sizing:border-box}body{font:15px system-ui,sans-serif;background:#f5f3ed;color:#29382d;margin:0;padding:30px;line-height:1.7}main{max-width:1100px;margin:auto}h1{font-size:28px}h2{font-size:18px}.player{position:sticky;top:0;background:#f5f3ed;padding:12px 0;z-index:1}audio{width:100%}.columns{display:grid;grid-template-columns:1fr 1fr;gap:18px}.column{background:white;padding:20px;border-radius:12px}.passage{display:flex;width:100%;gap:12px;border:0;background:transparent;text-align:left;padding:10px;color:inherit;font:inherit;cursor:pointer}.passage:hover,button:hover{background:#e8efdf}.passage time{font-size:11px;min-width:75px;color:#738368}button{cursor:pointer;border:1px solid #d5ddca;background:#f8faf4;border-radius:6px;padding:6px 9px;color:inherit}table{width:100%;border-collapse:collapse;font-size:13px;background:white}td,th{padding:12px;border-bottom:1px solid #e4e7db;text-align:left;vertical-align:top}td small{display:block;color:#89947d;margin-top:6px}.table{overflow-x:auto}small{font-size:11px}a{color:#496741}@media(max-width:650px){body{padding:16px}.columns{grid-template-columns:1fr}}:focus-visible{outline:3px solid #769758;outline-offset:2px}</style><main>
<h1>前一分鐘字幕比較</h1><p>兩份稿都不是人工校正版。點時間可回聽原音；差異不代表哪一方一定正確。</p><div class="player"><audio id="audio" controls preload="metadata" src="audio-0-60.wav"></audio><p id="status" role="status">原始日文音訊 · 0–60 秒</p></div>
<p>獨立模型：MODEL。沒有餵入 YouTube 字幕。字元對齊相似度 SIMILARITY（不是準確率）。此頁保留原始比較；App 採用狀態見 README。</p>
<h2>需要審查的差異</h2><div class="table"><table><thead><tr><th>回聽</th><th>YouTube</th><th>獨立辨識</th><th>狀態</th></tr></thead><tbody>ROWS</tbody></table></div>
<div class="columns"><section class="column"><h2>YouTube 原始日文字幕</h2>YOUTUBE</section><section class="column"><h2>獨立音訊辨識稿</h2>ASR</section></div><p><a href="analysis-notes.md">分析與建議</a> · <a href="dictionary-audit.md">字典候選</a> · <a href="comparison.md">完整比較報告</a> · <a href="comparison.json">差異資料 JSON</a></p></main>
<script>const audio=document.querySelector('#audio');document.addEventListener('click',event=>{const button=event.target.closest('button[data-time]');if(button){audio.currentTime=Number(button.dataset.time);audio.play().catch(()=>{document.querySelector('#status').textContent='請按播放器的播放鍵開始回聽。';});}});</script></html>'''
for marker, content in [('MODEL', html.escape(asr['metadata']['model'])), ('SIMILARITY', f'{matcher.ratio():.1%}'), ('ROWS', rows), ('YOUTUBE', segment_html(youtube)), ('ASR', segment_html(asr['segments']))]:
    page = page.replace(marker, content)
(out / 'review.html').write_text(page, encoding='utf-8')
print(f'Compared {len(youtube)} YouTube cues and {len(asr["segments"])} ASR segments: {len(differences)} difference groups, similarity {matcher.ratio():.1%} (not accuracy).')
