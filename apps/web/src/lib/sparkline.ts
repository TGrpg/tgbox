/** `points` attribute for an SVG polyline spanning `width` × `height`. */
export function sparklinePoints(values: number[], width: number, height: number): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const range = Math.max(...values) - min;
  const round = (value: number) => Math.round(value * 100) / 100;
  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * width;
      const y = range === 0 ? height / 2 : height - ((value - min) / range) * height;
      return `${round(x)},${round(y)}`;
    })
    .join(" ");
}
