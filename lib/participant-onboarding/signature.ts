export type SignaturePoint = [number, number];
export type SignatureStrokes = SignaturePoint[][];
export function parseSignature(value: string): SignatureStrokes {
  if (!value) return [];
  const strokes: unknown = JSON.parse(value);
  if (!Array.isArray(strokes) || !strokes.length || strokes.length > 100) throw new Error("Invalid signature.");
  let count = 0;
  for (const stroke of strokes) {
    if (!Array.isArray(stroke) || !stroke.length) throw new Error("Invalid signature stroke.");
    count += stroke.length;
    for (const point of stroke) {
      if (!Array.isArray(point) || point.length !== 2 || point.some((n) => !Number.isInteger(n) || n < 0 || n > 1000)) throw new Error("Invalid signature point.");
    }
  }
  if (count > 1500) throw new Error("Signature is too detailed. Clear it and draw again.");
  return strokes as SignatureStrokes;
}
