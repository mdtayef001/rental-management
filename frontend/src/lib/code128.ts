/**
 * Code 128 barcodes, drawn by us rather than by a library.
 *
 * Code 128 is what every handheld and USB scanner reads out of the box, it holds letters as
 * well as digits (SKUs like "SEW-001"), and it is compact. A symbol is a start character, the
 * data, a checksum and a stop character; each character is three bars and three spaces whose
 * widths, in modules, are listed below.
 *
 * All-digit text is packed two digits per character (code set C), which makes a 13-digit
 * EAN-style number about a third narrower — so on a small label each bar is thicker and
 * easier for a thermal printer to draw and a scanner to read. An odd last digit switches to
 * code set B for itself. Anything else uses code set B, which covers printable ASCII.
 */

// Bar/space widths for values 0–106, in order. 103–105 are Start A/B/C, 106 is Stop.
export const PATTERNS = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
]

const START_B = 104
const START_C = 105
const STOP = 106
/** In code set C, switches to code set B for the characters after it. */
const CODE_B = 100

/** Can this text be drawn as Code 128 here? Printable ASCII only. */
export function encodable(text: string) {
  return text.length > 0 && /^[\x20-\x7e]+$/.test(text)
}

/** The symbol's character values: start, data, checksum, stop. */
export function code128Values(text: string): number[] {
  if (!encodable(text)) throw new Error(`Can't draw "${text}" as a barcode.`)
  const digits = /^\d+$/.test(text) && text.length >= 2
  const pairs = Math.floor(text.length / 2)
  const data = digits
    ? [
        ...Array.from({ length: pairs }, (_, i) => Number(text.slice(i * 2, i * 2 + 2))),
        // An odd digit left over: switch to code set B for it.
        ...(text.length % 2 ? [CODE_B, text.charCodeAt(text.length - 1) - 32] : []),
      ]
    : Array.from(text, (char) => char.charCodeAt(0) - 32)
  const start = digits ? START_C : START_B
  // The checksum weights each data character by its position, counting from 1.
  const checksum = data.reduce((sum, value, i) => sum + value * (i + 1), start) % 103
  return [start, ...data, checksum, STOP]
}

/**
 * The bars, as `[x, width]` pairs in modules, and the symbol's total width in modules.
 * Quiet zones are left to the caller: a label leaves white space around it anyway.
 */
export function code128Bars(text: string) {
  const bars: [number, number][] = []
  let x = 0
  for (const value of code128Values(text)) {
    Array.from(PATTERNS[value]).forEach((width, i) => {
      // Even positions in a pattern are bars, odd ones spaces.
      if (i % 2 === 0) bars.push([x, Number(width)])
      x += Number(width)
    })
  }
  return { bars, width: x }
}
