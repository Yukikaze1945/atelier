// Adapted from Moyf/moys-asr-workflow (web/editor.js), AGPL-3.0. See LICENSE.
function parseSrtTimestamp(value) {
  const match = /^(\d+):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const milliseconds = Number(match[4].padEnd(3, '0'));
  if (minutes >= 60 || seconds >= 60) return null;
  return (((hours * 60 + minutes) * 60) + seconds) * 1000 + milliseconds;
}

function parseSrtSegments(text) {
  const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim().split(/\n{2,}/);
  const segments = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (/^\d+$/.test(lines[0]?.trim() || '')) lines.shift();
    const timing = /^\s*(.+?)\s*-->\s*(.+?)(?:\s+.*)?$/.exec(lines.shift() || '');
    if (!timing) throw new Error('缺少有效时间码');
    const start = parseSrtTimestamp(timing[1]);
    const end = parseSrtTimestamp(timing[2]);
    const cueText = lines.join('\n').trim();
    if (start === null || end === null || end <= start || !cueText) throw new Error('包含无效字幕段');
    const previous = segments[segments.length - 1];
    if (previous && start < previous.end) throw new Error('字幕时间重叠');
    segments.push({ start, end, text: cueText });
  }
  if (!segments.length) throw new Error('没有可导入的字幕');
  return segments;
}
