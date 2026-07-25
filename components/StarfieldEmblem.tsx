"use client";

export function StarfieldEmblem({ size = 22, className, style }: { size?: number; className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 400 400"
      fill="none"
      className={className}
      style={{ flexShrink: 0, display: "inline-block", verticalAlign: "middle", ...style }}
      aria-hidden="true"
    >
      {/* Layer 1: Star Navy */}
      <path d="M 200,40 Q 240,160 360,200 Q 240,240 200,360 Q 160,240 40,200 Q 160,160 200,40 Z" fill="#1B365D" />
      {/* Layer 2: Constellation Gold */}
      <path d="M 200,75 Q 230,170 325,200 Q 230,230 200,325 Q 170,230 75,200 Q 170,170 200,75 Z" fill="#D99B26" />
      {/* Layer 3: Starfield Orange */}
      <path d="M 200,110 Q 220,180 290,200 Q 220,220 200,290 Q 180,220 110,200 Q 180,180 200,110 Z" fill="#E05A2B" />
      {/* Layer 4: Starfield Red */}
      <path d="M 200,145 Q 210,190 255,200 Q 210,210 200,255 Q 190,210 145,200 Q 190,190 200,145 Z" fill="#C81D25" />
      {/* White Core */}
      <circle cx="200" cy="200" r="18" fill="#FFFFFF" />
    </svg>
  );
}
