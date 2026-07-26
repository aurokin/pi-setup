/**
 * The startup logo's colours, derived from the active theme.
 *
 * This used to be six hardcoded RGB stops — github's blue ramp, left behind
 * when the theme changed, so the logo went on advertising a palette nothing
 * else in the UI used. A themed element that cannot follow the theme is just a
 * slower kind of wrong, so the ramp is built from `accent` instead.
 *
 * `Theme` exposes colours only as ANSI escapes, and `getResolvedThemeColors`
 * is not part of the extension API, so the accent is read back out of the
 * escape sequence it hands us.
 */

export type Rgb = [number, number, number];

/** How many stops the gradient cycles through. */
export const RAMP_STOPS = 6;

/**
 * Pull the RGB out of a truecolor SGR sequence.
 *
 * Returns undefined for the 256- and 16-colour forms (`38;5;N`), which carry a
 * palette index rather than a colour — there is nothing to interpolate between,
 * and the caller falls back to painting the logo flat.
 */
export function parseTruecolor(ansi: string): Rgb | undefined {
  const match = /\x1b\[(?:[\d;]*;)?38;2;(\d{1,3});(\d{1,3});(\d{1,3})m/.exec(
    ansi,
  );
  if (!match) return undefined;
  const rgb = [Number(match[1]), Number(match[2]), Number(match[3])] as Rgb;
  return rgb.every((channel) => channel >= 0 && channel <= 255)
    ? rgb
    : undefined;
}

function mix(a: number, b: number, amount: number): number {
  return Math.round(a + (b - a) * amount);
}

function toward(color: Rgb, target: 0 | 255, amount: number): Rgb {
  return [
    mix(color[0], target, amount),
    mix(color[1], target, amount),
    mix(color[2], target, amount),
  ];
}

/**
 * Six stops running dark → accent → bright → accent, so the gradient reads as
 * a sweep across the letterforms and still joins cleanly where it wraps.
 *
 * Shading toward black and white rather than toward other theme colours keeps
 * this in one hue: a ramp built from `accent` and, say, `success` would turn
 * the logo into whatever two colours a theme happened to pick.
 */
export function accentRamp(accent: Rgb): Rgb[] {
  const shade = toward(accent, 0, 0.45);
  const light = toward(accent, 255, 0.28);
  const bright = toward(accent, 255, 0.55);
  return [shade, accent, light, bright, light, accent];
}
