import assert from "node:assert/strict";
import { test } from "node:test";
import {
  accentRamp,
  parseTruecolor,
  RAMP_STOPS,
  type Rgb,
} from "./src/accent-ramp.ts";

const TOKYO_NIGHT_ACCENT: Rgb = [122, 162, 247];

test("the accent is read back out of a truecolor escape", () => {
  // This is the only way to reach a theme colour as RGB: Theme exposes ANSI,
  // and getResolvedThemeColors is not part of the extension API.
  assert.deepEqual(
    parseTruecolor("\x1b[38;2;122;162;247m"),
    TOKYO_NIGHT_ACCENT,
  );
});

test("a palette-indexed colour yields nothing to interpolate", () => {
  // 256- and 16-colour terminals get an index, not a colour. Guessing an RGB
  // for it would paint the logo in something the terminal never agreed to.
  assert.equal(parseTruecolor("\x1b[38;5;33m"), undefined);
  assert.equal(parseTruecolor("\x1b[34m"), undefined);
  assert.equal(parseTruecolor(""), undefined);
});

test("channels outside the byte range are refused rather than clamped", () => {
  assert.equal(parseTruecolor("\x1b[38;2;300;0;0m"), undefined);
});

test("a compound escape still yields its truecolor foreground", () => {
  // Themes may emit bold or background attributes in the same sequence.
  assert.deepEqual(parseTruecolor("\x1b[1;38;2;10;20;30m"), [10, 20, 30]);
});

test("the ramp keeps the shape the gradient sweeps across", () => {
  const ramp = accentRamp(TOKYO_NIGHT_ACCENT);
  assert.equal(ramp.length, RAMP_STOPS);
  // dark -> accent -> bright -> accent, so it joins cleanly where it wraps.
  assert.deepEqual(ramp[1], TOKYO_NIGHT_ACCENT);
  assert.deepEqual(ramp[5], TOKYO_NIGHT_ACCENT);
  assert.deepEqual(ramp[2], ramp[4]);
});

test("the ramp runs dark to bright without leaving the byte range", () => {
  for (const accent of [
    TOKYO_NIGHT_ACCENT,
    [0, 0, 0],
    [255, 255, 255],
    [138, 190, 183],
  ] as Rgb[]) {
    const ramp = accentRamp(accent);
    const luma = ramp.map(([r, g, b]) => r + g + b);
    assert.ok(luma[0]! <= luma[1]!, "the first stop is the darkest");
    assert.ok(luma[3]! >= luma[2]!, "the fourth stop is the brightest");
    for (const stop of ramp) {
      for (const channel of stop) {
        assert.ok(
          Number.isInteger(channel) && channel >= 0 && channel <= 255,
          `channel ${channel} is not a byte`,
        );
      }
    }
  }
});

test("the ramp stays in the accent's hue", () => {
  // Shading toward black and white rather than toward another theme colour is
  // what keeps this a logo rather than whatever two colours a theme picked.
  const [r, g, b] = TOKYO_NIGHT_ACCENT;
  for (const stop of accentRamp(TOKYO_NIGHT_ACCENT)) {
    assert.equal(
      stop[2] >= stop[1] && stop[1] >= stop[0],
      b >= g && g >= r,
      `stop ${stop} inverted the channel ordering of the accent`,
    );
  }
});
