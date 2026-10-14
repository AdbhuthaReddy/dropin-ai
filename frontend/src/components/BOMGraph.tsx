"use client";

import ThreeDBudsPro from "./ThreeDBudsPro";

interface BOMGraphProps {
  onNodeClick: () => void;
}

export default function BOMGraph({ onNodeClick }: BOMGraphProps) {
  return <ThreeDBudsPro onPmicClick={onNodeClick} />;
}
