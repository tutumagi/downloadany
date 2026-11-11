import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function createFixture(directory, kind = 'mpegts', audioCodec = 'aac') {
  mkdirSync(directory, { recursive: true });
  const ext = kind === 'fmp4' ? 'm4s' : 'ts';
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=12',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '5',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
    '-g', '24', '-keyint_min', '24', '-sc_threshold', '0', '-c:a', audioCodec,
    '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0', '-hls_segment_type', kind,
    '-hls_segment_filename', join(directory, 'part-%d.' + ext), join(directory, 'media.m3u8'),
  ], { cwd: directory, stdio: 'inherit' });
}

export function probe(file) {
  return JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name', '-of', 'json', file,
  ], { encoding: 'utf8' }));
}
