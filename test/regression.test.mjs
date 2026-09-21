import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function load(file, globals = {}) {
  const context = vm.createContext({
    _requireSequence: () => null,
    _ok: (value = {}) => JSON.stringify(value),
    _err: error => JSON.stringify({ error }),
    ...globals,
  });
  vm.runInContext(readFileSync(new URL(`../cep/jsx/${file}`, import.meta.url), 'utf8'), context);
  return context;
}
const collection = (values, countKey = 'numItems') => Object.assign(values, { [countKey]: values.length });

for (const locale of ['Chinese', 'English']) {
  test(`${locale} clip volume: observed zero, -6 dB, readback and rejected inputs`, () => {
    let raw = 0.17782793939114; // Value observed in PR at 0 dB.
    let writes = 0;
    const level = {
      displayName: locale === 'Chinese' ? '级别' : 'Level',
      getValue: () => raw,
      setValue(value) { writes++; raw = value; },
    };
    const clip = { components: collection([
      { displayName: 'Unrelated', matchName: 'other', properties: collection([]) },
      { displayName: locale === 'Chinese' ? '音量' : 'Volume', matchName: 'Internal Volume Mono', properties: collection([level]) },
    ]) };
    const ctx = load('audio.jsx', { _getClip: () => clip });
    assert.ok(Math.abs(JSON.parse(ctx.getClipVolume(0, 0)).volumeDb) < 0.00001);
    ctx.setClipVolume(0, 0, -6);
    assert.ok(Math.abs(raw - 0.0891250938) < 1e-9);
    assert.ok(Math.abs(JSON.parse(ctx.getClipVolume(0, 0)).volumeDb + 6) < 1e-9);
    const previousWrites = writes;
    for (const invalid of [NaN, Infinity, -Infinity, -97, 16]) {
      assert.match(JSON.parse(ctx.setClipVolume(0, 0, invalid)).error, /Volume/);
    }
    assert.equal(writes, previousWrites);
    ctx.setClipVolume(0, 0, -96);
    assert.equal(raw, 0);
    assert.equal(JSON.parse(ctx.getClipVolume(0, 0)).volumeDb, -96);
    ctx.setClipVolume(0, 0, 15);
    assert.equal(raw, 1);
    // The returned value must describe host readback, not simply echo the request.
    level.setValue = () => { raw = 0.17782793939114; };
    assert.ok(Math.abs(JSON.parse(ctx.setClipVolume(0, 0, -6)).volumeDb) < 0.00001);
  });
}

test('volume reports absent sequence, clip or volume effect', () => {
  let ctx = load('audio.jsx', { _requireSequence: () => '{"error":"No sequence"}' });
  assert.equal(JSON.parse(ctx.setClipVolume(0, 0, 0)).error, 'No sequence');
  ctx = load('audio.jsx', { _getClip: () => null });
  assert.equal(JSON.parse(ctx.getClipVolume(0, 0)).error, 'Clip not found');
  ctx = load('audio.jsx', { _getClip: () => ({ components: collection([]) }) });
  assert.equal(JSON.parse(ctx.setClipVolume(0, 0, 0)).error, 'Volume component not found');
});

test('razor forwards Premiere-formatted time, sequence timebase and display format to the requested track', () => {
  const calls = [];
  const sequence = { timebase: '8467200000', videoDisplayFormat: 102 };
  const ctx = load('timeline.jsx', {
    Time: function () {},
    app: { project: { activeSequence: sequence }, enableQE() {} },
    _makeTime: seconds => ({ getFormatted(frame, format) {
      assert.equal(seconds, 2);
      assert.equal(frame.ticks, sequence.timebase);
      assert.equal(format, sequence.videoDisplayFormat);
      return '00:00:02:00';
    } }),
    qe: { project: { getActiveSequence: () => ({
      getVideoTrackAt: index => ({ razor: time => calls.push(['video', index, time]) }),
      getAudioTrackAt: index => ({ razor: time => calls.push(['audio', index, time]) }),
    }) } },
  });
  ctx.razorClip('video', 1, 2);
  ctx.razorClip('audio', 0, 2);
  assert.deepEqual(calls, [['video', 1, '00:00:02:00'], ['audio', 0, '00:00:02:00']]);
});

test('timeline enabled and selected flags remain independent', () => {
  const clips = [];
  for (const disabled of [false, true]) for (const selected of [false, true]) {
    clips.push({ disabled, isSelected: () => selected,
      start: { seconds: 0 }, end: { seconds: 1 }, duration: { seconds: 1 },
      inPoint: { seconds: 0 }, outPoint: { seconds: 1 },
    });
  }
  const ctx = load('timeline.jsx', { app: { project: { activeSequence: {
    videoTracks: collection([{ clips: collection(clips) }], 'numTracks'),
    audioTracks: collection([], 'numTracks'),
  } } } });
  const result = JSON.parse(ctx.getTimelineClips('all', -1));
  assert.deepEqual(result.map(clip => [clip.enabled, clip.selected]),
    [[true, false], [true, true], [false, false], [false, true]]);
});
