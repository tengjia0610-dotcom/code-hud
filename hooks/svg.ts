import { COLORS, gaugeColor } from './format'
import type { Pose } from './mascot'

// ---- ring gauge (20x20) ----

const R = 8
const CIRC = 2 * Math.PI * R

/** The ring's markup in its own 20x20 space: a gray track and, with a reading, the arc in the gauge colour. */
function ringMarkup(percent: number | undefined): string {
  const ring = (stroke: string, extra: string): string =>
    `<circle cx="10" cy="10" r="${R}" fill="none" stroke="${stroke}" stroke-width="3"${extra}/>`
  let arc = ''
  if (percent !== undefined && !Number.isNaN(percent)) {
    const len = (Math.min(100, Math.max(0, percent)) / 100) * CIRC
    if (len > 0) {
      arc = ring(gaugeColor(percent),
        ` stroke-linecap="round" stroke-dasharray="${len.toFixed(2)} ${CIRC.toFixed(2)}" transform="rotate(-90 10 10)"`)
    }
  }
  return ring(COLORS.gray, ' stroke-opacity="0.3"') + arc
}

export function ringSvg(percent: number | undefined, size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 20 20">` +
    ringMarkup(percent) + '</svg>'
}

// ---- chip (the band's status tiles) ----
// The one place the chip's look is set: height, corner radius, fill strength, type and spacing.

const CHIP_HEIGHT = 26
const CHIP_RADIUS = 6
const CHIP_FILL_OPACITY = 0.18
const CHIP_PAD_X = 9
const CHIP_PART_GAP = 5
const CHIP_FONT_SIZE = 13
const CHIP_FONT_WEIGHT = 500
const CHIP_RING = 14
const CHIP_FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Helvetica Neue', sans-serif"

export type ChipPart = { text: string; color?: string; weight?: 400 | 500 | 600 } | { ring: number | undefined }

// Weight 600 draws wider than the table below (measured at 500).
const CHIP_BOLD_FACTOR = 1.06

/** Text an XML 1.0 document may hold: tab, LF and CR become one space; other C0 controls and lone surrogates go. */
const cleanText = (text: string): string =>
  text
    .replace(/[\t\n\r]+/g, ' ')
    .replace(/[\u0000-\u001F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')

const escapeXml = (text: string): string =>
  text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c)

/** Estimated width of one character at 13 px (no text measurement here); over rather than under. */
function charWidth(c: string): number {
  if (c === ' ') return 3.6
  if (/[A-Z]/.test(c)) return 8.6
  if (/[0-9]/.test(c)) return 8.0
  if (/[a-z]/.test(c)) return 7.2
  if (c === '%') return 12
  if (c === '*') return 6.5
  if ('.-_·:/?'.includes(c)) return 4.6
  return 13
}

const textWidth = (text: string): number => [...text].reduce((sum, c) => sum + charWidth(c), 0)

/** A rounded, tinted tile holding text and ring parts left to right, vertically centred. */
export function chipSvg(parts: ChipPart[], color: string): { source: string; width: number; height: number } {
  let x = CHIP_PAD_X
  let body = ''
  parts.forEach((part, i) => {
    if (i > 0) x += CHIP_PART_GAP
    if ('ring' in part) {
      const y = (CHIP_HEIGHT - CHIP_RING) / 2
      body += `<g transform="translate(${x} ${y}) scale(${CHIP_RING / 20})">${ringMarkup(part.ring)}</g>`
      x += CHIP_RING
    } else {
      // dominant-baseline central at the tile's middle: centred whatever the font's ascent.
      const text = cleanText(part.text)
      body += `<text x="${x}" y="${CHIP_HEIGHT / 2}" dominant-baseline="central" font-size="${CHIP_FONT_SIZE}"` +
        ` font-weight="${part.weight ?? CHIP_FONT_WEIGHT}" fill="${escapeXml(part.color ?? color)}">${escapeXml(text)}</text>`
      x += textWidth(text) * (part.weight === 600 ? CHIP_BOLD_FACTOR : 1)
    }
  })
  const width = Math.ceil(x + CHIP_PAD_X)
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${CHIP_HEIGHT}" viewBox="0 0 ${width} ${CHIP_HEIGHT}"` +
    ` font-family="${CHIP_FONT}">` +
    `<rect x="0" y="0" width="${width}" height="${CHIP_HEIGHT}" rx="${CHIP_RADIUS}" fill="${escapeXml(color)}" fill-opacity="${CHIP_FILL_OPACITY}"/>` +
    body + '</svg>'
  return { source, width, height: CHIP_HEIGHT }
}

// ---- card (the pane's metric tiles) ----

const CARD_RADIUS = 8
const CARD_PAD = 12
const CARD_LINE_GAP = 4
const CARD_LABEL_SIZE = 12
const CARD_VALUE_SIZE = 22
const CARD_SUB_SIZE = 11
const CARD_RING = 36
const CARD_RING_GAP = 10

export type Card = { label: string; value: string; sub?: string; ring?: number | undefined; color: string }

/** A rounded, tinted tile: a small gray label, a large value in `color`, an optional gray sub line; with a `ring` key, a ring at the left. */
export function cardSvg(card: Card): { source: string; width: number; height: number } {
  const lines: { text: string; size: number; weight: 400 | 600; color: string }[] = [
    { text: cleanText(card.label), size: CARD_LABEL_SIZE, weight: 400, color: COLORS.gray },
    { text: cleanText(card.value), size: CARD_VALUE_SIZE, weight: 600, color: card.color },
  ]
  if (card.sub !== undefined) lines.push({ text: cleanText(card.sub), size: CARD_SUB_SIZE, weight: 400, color: COLORS.gray })
  const hasRing = 'ring' in card
  const x = CARD_PAD + (hasRing ? CARD_RING + CARD_RING_GAP : 0)
  let y = CARD_PAD
  let widest = 0
  let body = ''
  lines.forEach((line, i) => {
    if (i > 0) y += CARD_LINE_GAP
    // Only the value has tabular digits.
    const tabular = line.weight === 600 ? ' style="font-variant-numeric: tabular-nums"' : ''
    body += `<text x="${x}" y="${y + line.size / 2}" dominant-baseline="central" font-size="${line.size}"` +
      ` font-weight="${line.weight}" fill="${escapeXml(line.color)}"${tabular}>${escapeXml(line.text)}</text>`
    y += line.size
    widest = Math.max(widest, textWidth(line.text) * (line.size / CHIP_FONT_SIZE) * (line.weight === 600 ? CHIP_BOLD_FACTOR : 1))
  })
  const height = y + CARD_PAD
  const width = Math.ceil(x + widest + CARD_PAD)
  const ring = hasRing
    ? `<g transform="translate(${CARD_PAD} ${(height - CARD_RING) / 2}) scale(${CARD_RING / 20})">${ringMarkup(card.ring)}</g>`
    : ''
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"` +
    ` font-family="${CHIP_FONT}">` +
    `<rect x="0" y="0" width="${width}" height="${height}" rx="${CARD_RADIUS}" fill="${COLORS.gray}" fill-opacity="${CHIP_FILL_OPACITY}"/>` +
    ring + body + '</svg>'
  return { source, width, height }
}

// ---- mascot (16x16 pixel grid) ----
// "Ember": a round little clay creature with two ear nubs, stubby arms and feet.
// Drawing is data: each part is a list of [x, y, w, h] cells painted in one color.

type Cell = [x: number, y: number, w: number, h: number]

const INK = '#3A2A22'     // eyes, mouths: dark brown, never pure black
const SHINE = '#FFFFFF'   // only at low opacity, as a highlight

const rects = (cells: Cell[]): string =>
  cells.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}"/>`).join('')

/** One color group; `anim` (an SMIL element) animates the whole group. */
const paint = (fill: string, cells: Cell[], opacity = 1, anim = ''): string =>
  `<g fill="${fill}"${opacity < 1 ? ` fill-opacity="${opacity}"` : ''}>${rects(cells)}${anim}</g>`

const timing = (dur: number, keyTimes?: string, begin?: number): string =>
  ` dur="${dur}s"${keyTimes ? ` keyTimes="${keyTimes}"` : ''}${begin ? ` begin="${begin}s"` : ''}` +
  ' calcMode="discrete" repeatCount="indefinite"/>'

/** Stepped translate, e.g. move('0 0;0 -1', 2.4). */
const move = (values: string, dur: number, keyTimes?: string, begin?: number): string =>
  `<animateTransform attributeName="transform" type="translate" values="${values}"` + timing(dur, keyTimes, begin)

/** Stepped visibility, e.g. show('0;1;0', 1.6, '0;.2;.85'). */
const show = (values: string, dur: number, keyTimes?: string): string =>
  `<animate attributeName="opacity" values="${values}"` + timing(dur, keyTimes)

// Base body shared by every pose.
const SILHOUETTE: Cell[] = [[4, 5, 2, 1], [10, 5, 2, 1], [4, 6, 8, 1], [3, 7, 10, 6], [4, 13, 8, 1], [4, 14, 2, 1], [10, 14, 2, 1]]
const HIGHLIGHT: Cell[] = [[5, 6, 2, 1], [4, 7, 1, 1]]
const SHADOW_LINE: Cell[] = [[4, 13, 8, 1], [4, 14, 2, 1], [10, 14, 2, 1]]
const ARMS_DOWN: Cell[] = [[2, 10, 1, 2], [13, 10, 1, 2]]
const EYES: Cell[] = [[5, 9, 1, 2], [10, 9, 1, 2]]
const GROUND: Cell[] = [[3, 15, 10, 1]]

type Look = {
  color?: string   // body color (default clay)
  face: string     // eyes, mouth, cheeks — moves with the body
  arms?: string    // replaces the default arms
  motion?: string  // animates the whole body group
  back?: string    // drawn behind the body, does not move with it
  front?: string   // drawn over the body, does not move with it
}

const ground = paint(COLORS.gray, GROUND, 0.3)

function draw({ color = COLORS.clay, face, arms, motion = '', back = ground, front = '' }: Look): string {
  const body = paint(color, SILHOUETTE) + paint(SHINE, HIGHLIGHT, 0.35) + paint(INK, SHADOW_LINE, 0.25) +
    (arms ?? paint(color, ARMS_DOWN)) + face
  return back + `<g>${body}${motion}</g>` + front
}

const C = COLORS.clay

const LOOKS: Record<Pose, Look> = {
  // gentle 1px bob every 2.4 s; blink every 3.2 s (the open eyes vanish over a closed-eye line)
  idle: {
    face: paint(INK, [[5, 10, 1, 1], [10, 10, 1, 1]]) + paint(INK, EYES, 1, show('1;0;1', 3.2, '0;.92;.97')),
    motion: move('0 0;0 -1', 2.4, '0;.5'),
  },
  // typing on a little laptop, hands tapping in turn
  working: {
    face: paint(INK, EYES),
    arms: paint(C, [[2, 10, 1, 2]], 1, move('0 0;0 1', 0.4, '0;.5')) +
      paint(C, [[13, 10, 1, 2]], 1, move('0 1;0 0', 0.4, '0;.5')),
    back: '',
    front: paint(COLORS.gray, [[3, 11, 10, 4], [1, 15, 14, 1]]) + paint(INK, [[1, 15, 14, 1]], 0.3) +
      paint(SHINE, [[7, 12, 2, 2]], 0.45),
  },
  // still body, eyes up, three dots rising one after another (all shown on the first frame)
  thinking: {
    face: paint(INK, [[6, 8, 1, 2], [11, 8, 1, 2], [8, 12, 2, 1]]),
    front: paint(C, [[7, 3, 2, 2]], 1, show('1;0;1', 1.8, '0;.25;.45')) +
      paint(C, [[10, 1, 2, 2]], 1, show('1;0;1', 1.8, '0;.25;.65')) +
      paint(C, [[13, 0, 2, 2]], 1, show('1;0;1', 1.8, '0;.25;.85')),
  },
  // ^ ^ eyes, open smile, blush, arms up, hopping
  happy: {
    face: paint(INK, [[4, 10, 1, 1], [5, 9, 1, 1], [6, 10, 1, 1], [9, 10, 1, 1], [10, 9, 1, 1], [11, 10, 1, 1], [7, 11, 2, 1]]) +
      paint(COLORS.red, [[3, 11, 2, 1], [11, 11, 2, 1]], 0.45),
    arms: paint(C, [[2, 9, 1, 1], [1, 7, 1, 2], [13, 9, 1, 1], [14, 7, 1, 2]]),
    motion: move('0 0;0 -2;0 -3;0 -2;0 0', 0.9, '0;.15;.3;.45;.6'),
  },
  // red, > < eyes, wobbly mouth, shaking side to side
  error: {
    color: COLORS.red,
    face: paint(INK, [[4, 9, 1, 1], [5, 10, 1, 1], [4, 11, 1, 1], [11, 9, 1, 1], [10, 10, 1, 1], [11, 11, 1, 1], [7, 12, 2, 1]]),
    motion: move('-1 0;1 0;-1 0;1 0;0 0', 0.8, '0;.1;.2;.3;.4'),
  },
  // right arm raised, hand waving
  waiting: {
    face: paint(INK, [...EYES, [7, 12, 2, 1]]),
    arms: paint(C, [[2, 10, 1, 2], [13, 9, 1, 2], [14, 6, 1, 3]]) + paint(C, [[13, 4, 2, 2]], 1, move('0 0;1 0', 0.6, '0;.5')),
  },
  // closed eyes, slow breathing, z then Z appearing above the head (both on the first frame)
  sleeping: {
    face: paint(INK, [[5, 10, 2, 1], [9, 10, 2, 1]]),
    motion: move('0 0;0 -1', 3, '0;.5'),
    front: paint(COLORS.gray, [[7, 1, 3, 1], [9, 2, 1, 1], [8, 3, 1, 1], [7, 4, 3, 1]], 1, show('1;0;1', 3, '0;.3;.45')) +
      paint(COLORS.gray, [[12, 0, 4, 1], [14, 1, 1, 1], [13, 2, 1, 1], [12, 3, 4, 1]], 1, show('1;0;1', 3, '0;.3;.7')),
  },
}

export function mascotSvg(p: Pose, size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 16 16" shape-rendering="crispEdges">` +
    draw(LOOKS[p]) + '</svg>'
}
