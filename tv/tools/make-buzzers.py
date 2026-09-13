#!/usr/bin/env python3
"""Cuts the recorded buzzers out of their source files.

The two recordings the gym supplied are not usable as they arrive: the boxing file
is 33 seconds holding three separate signals with long silences between them, and
both start with a moment of silence that would delay the buzzer.

This cuts on MP3 frame boundaries and copies the frames through untouched, so the
clips are exact excerpts of the originals rather than a re-encode — no generation
loss, and no encoder to install. Run:

    python3 tv/tools/make-buzzers.py <source-directory>

Sources (as uploaded):
    *opening-bell*.mp3                  a single struck bell
    *boxing-bell-signals*.mp3           one ring, then two, then three
"""
import glob
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'shared', 'web', 'buzzers')

BITRATES = {
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],   # MPEG1 Layer III
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],       # MPEG2/2.5 Layer III
}
RATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def id3_length(data):
    """ID3v2 tags sit in front of the audio and must not be copied into a clip."""
    if data[:3] != b'ID3':
        return 0
    size = 0
    for byte in data[6:10]:
        size = (size << 7) | (byte & 0x7F)
    return 10 + size


def frames(data):
    """Yields (offset, length, samples) for every MP3 frame in the file."""
    at = id3_length(data)
    end = len(data)
    while at + 4 <= end:
        if data[at] != 0xFF or (data[at + 1] & 0xE0) != 0xE0:
            at += 1                       # not a sync word: step over the junk
            continue
        version = (data[at + 1] >> 3) & 0x03
        layer = (data[at + 1] >> 1) & 0x03
        bitrate_index = (data[at + 2] >> 4) & 0x0F
        rate_index = (data[at + 2] >> 2) & 0x03
        padding = (data[at + 2] >> 1) & 0x01
        if layer != 1 or version == 1 or rate_index == 3 or bitrate_index in (0, 15):
            at += 1
            continue
        bitrate = BITRATES[1 if version == 3 else 2][bitrate_index] * 1000
        rate = RATES[version][rate_index]
        samples = 1152 if version == 3 else 576
        length = (samples // 8 * bitrate) // rate + padding
        if length < 4 or at + length > end:
            break
        yield at, length, samples, rate
        at += length


def cut(data, start_seconds, end_seconds):
    """Copies the frames covering a span, on frame boundaries."""
    kept, position, clock = [], 0, 0.0
    for offset, length, samples, rate in frames(data):
        span = samples / rate
        if clock + span > start_seconds and clock < end_seconds:
            kept.append(data[offset:offset + length])
        clock += span
        position = offset
    return b''.join(kept)


def write(name, payload):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path, 'wb') as handle:
        handle.write(payload)
    return path


def main():
    source = sys.argv[1] if len(sys.argv) > 1 else '.'

    def find(pattern):
        matches = glob.glob(os.path.join(source, pattern))
        if not matches:
            raise SystemExit('no source matching ' + pattern + ' in ' + source)
        return matches[0]

    opening = open(find('*opening-bell*.mp3'), 'rb').read()
    boxing = open(find('*boxing-bell-signals*.mp3'), 'rb').read()

    # A little lead-in keeps the MP3 bit reservoir happy and costs nothing; it lands
    # in silence either way. The tails are where each ring has decayed to nothing.
    # Ends chosen where each ring has decayed to nothing: trailing silence is
    # inaudible but it is still bytes shipped to every TV.
    pieces = [
        ('opening-bell.mp3', cut(opening, 0.05, 1.15)),
        ('boxing-bell.mp3', cut(boxing, 0.05, 0.90)),
        ('boxing-bell-3.mp3', cut(boxing, 17.80, 19.00)),
    ]
    for name, payload in pieces:
        path = write(name, payload)
        print('%-22s %7d bytes' % (name, len(payload)), '->', os.path.relpath(path, os.path.dirname(HERE)))


if __name__ == '__main__':
    main()
