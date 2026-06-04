interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  /** Stroke + fill accent (defaults to the success green). */
  color?: string;
  className?: string;
}

/** Minimal dependency-free SVG sparkline: line + faint area + endpoint dot. */
export function Sparkline({
  data,
  width = 104,
  height = 36,
  color = "var(--color-success)",
  className,
}: SparklineProps) {
  if (data.length < 2) return null;

  const pad = 3;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const usableH = height - pad * 2;

  const points = data.map((value, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = pad + (1 - (value - min) / range) * usableH;
    return [x, y] as const;
  });

  const line = points.map(([x, y]) => `${x},${y}`).join(" ");
  const area = `${line} ${width},${height} 0,${height}`;
  const [lastX, lastY] = points[points.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      aria-hidden
      className={className}
    >
      <polygon points={area} fill={color} fillOpacity={0.12} />
      <polyline
        points={line}
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r={2.2} fill={color} />
    </svg>
  );
}
