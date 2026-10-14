"use client";

import React, { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react";
import Link from "next/link";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Environment, ContactShadows, Html, Line } from "@react-three/drei";
import * as THREE from "three";
import {
  Zap,
  RotateCcw,
  X,
  Maximize2,
  AlertTriangle,
  Sparkles,
  Layers,
  ChevronRight,
  Info,
  CheckCircle2,
  AlertOctagon,
  ExternalLink,
  ShieldAlert,
  ArrowRight
} from "lucide-react";
import { useInventoryStore, InventoryItem } from "@/store/useInventoryStore";

// ============================================================================
// MOTION 3D SPRING PHYSICS ENGINE
// ============================================================================
interface MotionProps {
  animate?: {
    position?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number] | number;
  };
  transition?: {
    type?: "spring" | "tween";
    stiffness?: number;
    damping?: number;
    mass?: number;
  };
  children?: React.ReactNode;
  [key: string]: any;
}

const MotionGroup = forwardRef<THREE.Group, MotionProps>(({ animate, transition, children, ...props }, ref) => {
  const groupRef = useRef<THREE.Group>(null);
  useImperativeHandle(ref, () => groupRef.current!);

  const targetPos = (animate?.position as [number, number, number]) || [0, 0, 0];
  const stiffness = transition?.stiffness ?? 65;
  const damping = transition?.damping ?? 16;
  const mass = transition?.mass ?? 1;

  const currentPos = useRef<[number, number, number]>([targetPos[0], targetPos[1], targetPos[2]]);
  const velocity = useRef<[number, number, number]>([0, 0, 0]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const dt = Math.min(delta, 0.05);
    for (let i = 0; i < 3; i++) {
      const springForce = (targetPos[i] - currentPos.current[i]) * stiffness;
      const dampingForce = -velocity.current[i] * damping;
      const accel = (springForce + dampingForce) / mass;
      velocity.current[i] += accel * dt;
      currentPos.current[i] += velocity.current[i] * dt;
    }
    groupRef.current.position.set(currentPos.current[0], currentPos.current[1], currentPos.current[2]);
  });

  return (
    <group ref={groupRef} {...props}>
      {children}
    </group>
  );
});
MotionGroup.displayName = "MotionGroup";

// ============================================================================
// INDIVIDUAL DYNAMIC BOM COMPONENT MESH
// Reacts dynamically to inventory levels in Zustand store
// ============================================================================
interface BOMPartMeshProps {
  item: InventoryItem;
  isExploded: boolean;
  explodedX: number;
  compactX: number;
  isSelected: boolean;
  onSelect: (id: string) => void;
  onActionClick?: (mpn: string) => void;
}

function BOMPartMesh({
  item,
  isExploded,
  explodedX,
  compactX,
  isSelected,
  onSelect,
  onActionClick
}: BOMPartMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const pointLightRef = useRef<THREE.PointLight>(null);
  const isCritical = item.stock <= item.safetyStock;

  // Pulsing emissive warning beacon for any component breaching safety threshold
  useFrame((state) => {
    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.MeshStandardMaterial;
      if (mat) {
        if (isCritical) {
          const pulse = 1.8 + Math.sin(state.clock.elapsedTime * 5.0) * 0.9;
          mat.emissive.set("#ef4444");
          mat.emissiveIntensity = pulse;
          if (pointLightRef.current) {
            pointLightRef.current.intensity = pulse * 1.8;
          }
        } else {
          mat.emissive.set("#000000");
          mat.emissiveIntensity = 0;
          if (pointLightRef.current) {
            pointLightRef.current.intensity = 0;
          }
        }
      }
    }
  });

  const posX = isExploded ? explodedX : compactX;
  const showAnnotation = isSelected || isCritical;

  // Render specific geometric primitive based on meshType
  const renderGeometry = () => {
    switch (item.meshType) {
      case "dome": // 1. Outer Shell
        return (
          <mesh
            ref={meshRef}
            rotation={[0, 0, -Math.PI / 2]}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(item.id);
            }}
          >
            <sphereGeometry args={[1.3, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial
              color="#e85d75"
              roughness={0.45}
              metalness={0.05}
              side={THREE.DoubleSide}
            />
          </mesh>
        );

      case "ring": // 2. Wind-blocking Acoustic Mesh
        return (
          <mesh
            ref={meshRef}
            rotation={[0, Math.PI / 2, 0]}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(item.id);
            }}
          >
            <torusGeometry args={[1.18, 0.05, 16, 36]} />
            <meshStandardMaterial
              color="#5f6368"
              roughness={0.35}
              metalness={0.8}
            />
          </mesh>
        );

      case "disc": // 3. Capacitive Touch Sensor
        return (
          <mesh
            ref={meshRef}
            rotation={[0, 0, Math.PI / 2]}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(item.id);
            }}
          >
            <cylinderGeometry args={[1.12, 1.12, 0.035, 32]} />
            <meshStandardMaterial
              color="#b87333"
              roughness={0.3}
              metalness={0.85}
            />
          </mesh>
        );

      case "pcb": // 4. Tensor A1 Mainboard
        return (
          <group
            onClick={(e) => {
              e.stopPropagation();
              onSelect(item.id);
            }}
          >
            {/* Green PCB Board */}
            <mesh ref={meshRef} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[1.08, 1.08, 0.07, 32]} />
              <meshStandardMaterial
                color="#134e2f"
                roughness={0.4}
                metalness={0.25}
              />
            </mesh>
            {/* Tensor A1 Silicon Die */}
            <mesh position={[0.06, 0, 0]}>
              <boxGeometry args={[0.06, 0.5, 0.5]} />
              <meshStandardMaterial
                color="#202124"
                roughness={0.25}
                metalness={0.7}
              />
            </mesh>
          </group>
        );

      case "chip": // 5. NXP BQ25611 PMIC
        return (
          <group
            onClick={(e) => {
              e.stopPropagation();
              onSelect(item.id);
            }}
          >
            <mesh ref={meshRef} position={[0, 0.25, 0.15]}>
              <boxGeometry args={[0.38, 0.2, 0.32]} />
              <meshStandardMaterial
                color="#1e1e1e"
                roughness={0.3}
                metalness={0.6}
              />
            </mesh>
            {/* Solder Bump Pins */}
            <mesh position={[0, 0.12, 0.15]}>
              <boxGeometry args={[0.32, 0.04, 0.26]} />
              <meshStandardMaterial color="#c0c0c0" metalness={0.9} roughness={0.2} />
            </mesh>
          </group>
        );

      case "micCluster": // 6. 3x MEMS Mic Array
        return (
          <group
            onClick={(e) => {
              e.stopPropagation();
              onSelect(item.id);
            }}
          >
            <mesh ref={meshRef} position={[0, 0.65, 0]}>
              <boxGeometry args={[0.16, 0.14, 0.16]} />
              <meshStandardMaterial color="#d4af37" roughness={0.25} metalness={0.9} />
            </mesh>
            <mesh position={[0, -0.4, 0.5]}>
              <boxGeometry args={[0.16, 0.14, 0.16]} />
              <meshStandardMaterial color="#d4af37" roughness={0.25} metalness={0.9} />
            </mesh>
            <mesh position={[0, -0.4, -0.5]}>
              <boxGeometry args={[0.16, 0.14, 0.16]} />
              <meshStandardMaterial color="#d4af37" roughness={0.25} metalness={0.9} />
            </mesh>
          </group>
        );

      case "sensorBox": // 7. 6-Axis IMU
        return (
          <mesh
            ref={meshRef}
            position={[0, -0.2, 0.1]}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(item.id);
            }}
          >
            <boxGeometry args={[0.3, 0.18, 0.28]} />
            <meshStandardMaterial
              color="#111111"
              roughness={0.6}
              metalness={0.15}
            />
          </mesh>
        );

      case "cylinderCell": // 8. VARTA CP1154 Coin Cell Battery
        return (
          <mesh
            ref={meshRef}
            rotation={[0, 0, Math.PI / 2]}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(item.id);
            }}
          >
            <cylinderGeometry args={[1.02, 1.02, 0.62, 32]} />
            <meshStandardMaterial
              color="#e2e8f0"
              roughness={0.2}
              metalness={0.95}
            />
          </mesh>
        );

      case "driverCone": // 9. 11mm Dynamic Transducer
        return (
          <group
            onClick={(e) => {
              e.stopPropagation();
              onSelect(item.id);
            }}
          >
            <mesh ref={meshRef} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[0.9, 0.55, 0.48, 32]} />
              <meshStandardMaterial
                color="#374151"
                roughness={0.3}
                metalness={0.85}
              />
            </mesh>
            {/* Inner Voice Coil Ring */}
            <mesh position={[-0.26, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
              <torusGeometry args={[0.32, 0.05, 16, 32]} />
              <meshStandardMaterial color="#c27803" metalness={0.8} roughness={0.3} />
            </mesh>
          </group>
        );

      case "siliconeTip": // 10. Liquid Silicone Eartip
      default:
        return (
          <mesh
            ref={meshRef}
            rotation={[0, 0, Math.PI / 2]}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(item.id);
            }}
          >
            <sphereGeometry args={[0.82, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.78]} />
            <meshPhysicalMaterial
              color="#ffffff"
              roughness={0.15}
              transmission={0.85}
              opacity={0.6}
              transparent
              thickness={0.4}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
    }
  };

  return (
    <MotionGroup animate={{ position: [posX, 0, 0] }}>
      {renderGeometry()}

      {/* Point light accent for critical warnings */}
      {isCritical && (
        <pointLight
          ref={pointLightRef}
          position={[0, 0.5, 0]}
          color="#ff0000"
          distance={3.5}
          decay={2}
        />
      )}

      {/* DREI HTML ANNOTATION CARD (Revealed when clicked OR when stock <= safetyStock) */}
      {showAnnotation && (
        <Html
          position={[0, 1.4 + (item.layerIndex % 2 === 0 ? 0.3 : 0), 0]}
          center
          distanceFactor={11}
          zIndexRange={[100, 0]}
        >
          <div
            className={`w-[240px] p-3 rounded-xl shadow-lg border backdrop-blur-md transition-all select-none font-sans text-left ${
              isCritical
                ? "bg-white/95 border-red-500 shadow-[0_4px_20px_rgba(239,68,68,0.25)] ring-1 ring-red-400"
                : "bg-white/95 border-neutral-200/90 shadow-[0_4px_20px_rgba(0,0,0,0.08)]"
            }`}
          >
            <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-neutral-100">
              <span className="text-[10px] font-mono font-semibold text-neutral-500">
                LAYER {String(item.layerIndex).padStart(2, "0")} • {item.mpn}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect("");
                }}
                className="text-neutral-400 hover:text-neutral-700 p-0.5 cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            <div className="text-[12px] font-bold text-neutral-900 leading-tight">
              {item.name}
            </div>

            {/* Critical Alert Warning Badge */}
            {isCritical ? (
              <div className="mt-2 p-1.5 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-center gap-1.5 text-red-700 text-[10px] font-bold uppercase tracking-wider">
                  <AlertOctagon className="w-3.5 h-3.5 text-red-600 shrink-0" />
                  <span>
                    {item.stock === 0 ? "0 STOCK • LINE DOWN" : "BELOW SAFETY STOCK"}
                  </span>
                </div>
                <div className="text-[10px] text-red-600 mt-1 flex justify-between">
                  <span>Stock: {item.stock.toLocaleString()} EA</span>
                  <span>Safety: {item.safetyStock.toLocaleString()} EA</span>
                </div>
                <div className="text-[9px] text-neutral-600 mt-0.5">
                  Lead Time: <strong className="text-red-700">{item.leadTime}</strong>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onActionClick) onActionClick(item.mpn);
                  }}
                  className="mt-2 w-full py-1 bg-red-600 hover:bg-red-700 text-white font-bold text-[10px] uppercase rounded-md tracking-wider flex items-center justify-center gap-1 shadow-xs cursor-pointer"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Evaluate Replacement</span>
                </button>
              </div>
            ) : (
              <div className="mt-2 p-1.5 bg-emerald-50 border border-emerald-200 rounded-lg">
                <div className="flex items-center justify-between text-emerald-800 text-[10px] font-semibold">
                  <span className="flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                    <span>In Specification</span>
                  </span>
                  <span className="font-mono">{item.stock.toLocaleString()} EA</span>
                </div>
                <div className="text-[9px] text-neutral-500 mt-0.5">
                  Vendor: {item.vendor}
                </div>
              </div>
            )}
          </div>
        </Html>
      )}
    </MotionGroup>
  );
}

// ============================================================================
// FULL 10-PART PIXEL BUDS PRO 2 3D ASSEMBLY SCENE
// ============================================================================
function BudsScene({
  isExploded,
  onActionClick
}: {
  isExploded: boolean;
  onActionClick?: (mpn: string) => void;
}) {
  const { items, selectedPartId, setSelectedPartId } = useInventoryStore();

  // Horizontal coordinates for 10 meshes spread along the X-axis
  // Ordered from outer cap to ear canal
  const xPositions: Record<string, { exploded: number; compact: number }> = {
    "outer-shell": { exploded: 4.8, compact: 0.95 },
    "acoustic-mesh": { exploded: 3.8, compact: 0.78 },
    "touch-sensor": { exploded: 2.8, compact: 0.62 },
    "tensor-a1": { exploded: 1.8, compact: 0.44 },
    "pmic": { exploded: 0.9, compact: 0.28 },
    "mic-array": { exploded: 0.0, compact: 0.12 },
    "imu-sensor": { exploded: -0.9, compact: -0.05 },
    "battery": { exploded: -1.9, compact: -0.28 },
    "transducer": { exploded: -3.1, compact: -0.65 },
    "eartip": { exploded: -4.4, compact: -1.05 }
  };

  return (
    <group dispose={null} position={[0, 0, 0]}>
      {/* Horizontal Explosion Datum Guide Axis */}
      {isExploded && (
        <Line
          points={[
            [-5.4, 0, 0],
            [5.6, 0, 0]
          ]}
          color="#bdc1c6"
          lineWidth={1.2}
          transparent
          opacity={0.35}
          dashed
          dashScale={12}
          dashSize={0.4}
          gapSize={0.3}
        />
      )}

      {/* Render all 10 BOM meshes with dynamic Zustand bindings */}
      {items.map((item) => {
        const coords = xPositions[item.id] || { exploded: 0, compact: 0 };
        return (
          <BOMPartMesh
            key={item.id}
            item={item}
            isExploded={isExploded}
            explodedX={coords.exploded}
            compactX={coords.compact}
            isSelected={selectedPartId === item.id}
            onSelect={(id) => setSelectedPartId(id === selectedPartId ? null : id)}
            onActionClick={onActionClick}
          />
        );
      })}
    </group>
  );
}

// ============================================================================
// MAIN EXPORTED THREEDBUDSPRO COMPONENT
// ============================================================================
export default function ThreeDBudsPro({
  onPmicClick,
  className = ""
}: {
  onPmicClick?: () => void;
  className?: string;
}) {
  const [isExploded, setIsExploded] = useState(true);
  const orbitRef = useRef<any>(null);

  const { items, selectedPartId, setSelectedPartId, simulateShortage, resetAll } =
    useInventoryStore();

  const criticalCount = items.filter((i) => i.stock <= i.safetyStock).length;

  const handleResetCamera = () => {
    if (orbitRef.current) {
      orbitRef.current.reset();
    }
  };

  return (
    <div className={`w-full h-full relative overflow-hidden bg-[#f8f9fa] select-none ${className}`}>
      {/* WebGL 3D Canvas */}
      <Canvas
        shadows
        camera={{ position: [0, 3.2, 10], fov: 36 }}
        className="w-full h-full cursor-grab active:cursor-grabbing"
      >
        <ambientLight intensity={0.9} />
        <directionalLight
          position={[8, 12, 10]}
          intensity={1.4}
          castShadow
          shadow-mapSize-width={1024}
          shadow-mapSize-height={1024}
        />
        <directionalLight position={[-8, -4, -6]} intensity={0.5} />
        <Environment preset="studio" />

        <BudsScene
          isExploded={isExploded}
          onActionClick={(mpn) => {
            if (onPmicClick) onPmicClick();
          }}
        />

        <ContactShadows
          position={[0, -1.8, 0]}
          opacity={0.4}
          scale={15}
          blur={1.8}
          far={4}
        />

        <OrbitControls
          ref={orbitRef}
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          minDistance={3.5}
          maxDistance={18}
          maxPolarAngle={Math.PI / 2 + 0.15}
        />
      </Canvas>

      {/* TOP FLOATING OVERLAY: Title, Critical Badges & ERP Link */}
      <div className="absolute top-4 left-6 flex items-center gap-3 z-10 pointer-events-auto">
        <div className="px-3.5 py-2 rounded-xl bg-white/90 backdrop-blur-md border border-neutral-200/90 shadow-sm flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-[#1a73e8]" />
          <div>
            <h2 className="text-xs font-bold text-[#202124]">
              Google Pixel Buds Pro 2
            </h2>
            <p className="text-[10px] text-neutral-500">
              10-Part Parametric Digital Twin (GA03201)
            </p>
          </div>
        </div>

        {criticalCount > 0 ? (
          <div className="px-3 py-1.5 rounded-xl bg-red-50/95 backdrop-blur-md border border-red-200 text-red-700 text-xs font-semibold flex items-center gap-1.5 shadow-sm animate-pulse">
            <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
            <span>{criticalCount} Critical Shortage{criticalCount > 1 ? "s" : ""}</span>
          </div>
        ) : (
          <div className="px-3 py-1.5 rounded-xl bg-emerald-50/95 backdrop-blur-md border border-emerald-200 text-emerald-700 text-xs font-semibold flex items-center gap-1.5 shadow-sm">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>All 10 BOM Parts In Spec</span>
          </div>
        )}

        <Link
          href="/erp-simulator"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/90 hover:bg-white backdrop-blur-md border border-neutral-200 text-xs font-semibold text-[#0a6ed1] transition-all shadow-sm"
        >
          <span>Open SAP Fiori ERP</span>
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      {/* TOP RIGHT CONTROLS: Exploded Toggle & Reset View */}
      <div className="absolute top-4 right-6 flex items-center gap-2 z-10 pointer-events-auto">
        <button
          onClick={() => setIsExploded(!isExploded)}
          className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all shadow-sm border cursor-pointer ${
            isExploded
              ? "bg-[#1a73e8] text-white border-[#1557b0]"
              : "bg-white text-[#202124] border-neutral-200 hover:bg-neutral-50"
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>{isExploded ? "Exploded View (10 Parts)" : "Assembled Silhouette"}</span>
        </button>

        <button
          onClick={handleResetCamera}
          className="p-2 rounded-xl bg-white text-[#5f6368] hover:text-[#202124] border border-neutral-200 shadow-sm transition-colors cursor-pointer"
          title="Reset Camera View"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* BOTTOM 10-PART SELECTOR & QUICK TEST CONTROLS */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 z-10 pointer-events-auto max-w-[94%]">
        {/* Quick Testing Bar */}
        <div className="flex items-center gap-2 bg-white/95 backdrop-blur-md border border-neutral-200/90 rounded-2xl px-3 py-1.5 shadow-md text-xs">
          <span className="text-[11px] text-neutral-500 font-semibold uppercase tracking-wider pl-1">
            Simulate Shortage:
          </span>
          <button
            onClick={() => simulateShortage("pmic")}
            className="px-2.5 py-1 rounded-lg bg-neutral-100 hover:bg-red-50 hover:text-red-700 text-neutral-700 text-[11px] font-medium transition-colors cursor-pointer"
          >
            NXP PMIC
          </button>
          <button
            onClick={() => simulateShortage("battery")}
            className="px-2.5 py-1 rounded-lg bg-neutral-100 hover:bg-red-50 hover:text-red-700 text-neutral-700 text-[11px] font-medium transition-colors cursor-pointer"
          >
            Li-Ion Battery
          </button>
          <button
            onClick={() => simulateShortage("tensor-a1")}
            className="px-2.5 py-1 rounded-lg bg-neutral-100 hover:bg-red-50 hover:text-red-700 text-neutral-700 text-[11px] font-medium transition-colors cursor-pointer"
          >
            Tensor A1 DSP
          </button>
          <button
            onClick={() => simulateShortage("outer-shell")}
            className="px-2.5 py-1 rounded-lg bg-neutral-100 hover:bg-red-50 hover:text-red-700 text-neutral-700 text-[11px] font-medium transition-colors cursor-pointer"
          >
            Outer Shell
          </button>
          <div className="h-3 w-[1px] bg-neutral-300 mx-1" />
          <button
            onClick={resetAll}
            className="px-2.5 py-1 rounded-lg bg-neutral-100 hover:bg-neutral-200 text-neutral-600 text-[11px] font-medium transition-colors cursor-pointer"
          >
            Reset All
          </button>
        </div>

        {/* 10-Component Pill Navigator */}
        <div className="flex items-center gap-1.5 overflow-x-auto max-w-full px-2 py-1 scrollbar-none">
          {items.map((part) => {
            const isCrit = part.stock <= part.safetyStock;
            const isSel = selectedPartId === part.id;
            return (
              <button
                key={part.id}
                onClick={() => setSelectedPartId(isSel ? null : part.id)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold whitespace-nowrap transition-all border cursor-pointer ${
                  isCrit
                    ? "bg-red-500 text-white border-red-600 shadow-xs"
                    : isSel
                    ? "bg-[#1a73e8] text-white border-[#1557b0]"
                    : "bg-white/90 text-neutral-700 border-neutral-200/90 hover:bg-white"
                }`}
              >
                {part.name.split(" ")[0]} {isCrit && "⚠️"}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
