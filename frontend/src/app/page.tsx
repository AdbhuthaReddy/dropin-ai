"use client";

import { useState } from 'react';
import Link from 'next/link';
import ThreeDBudsPro from '@/components/ThreeDBudsPro';
import AIPanel from '@/components/AIPanel';
import { Sparkles, ShieldCheck, Box, Activity } from 'lucide-react';

export default function Dashboard() {
  const [panelOpen, setPanelOpen] = useState(false);

  return (
    <main className="w-screen h-screen flex flex-col bg-[#f8f9fa] text-[#202124] overflow-hidden relative font-sans">
      {/* Google Store Aesthetic Header */}
      <header className="h-16 border-b border-neutral-200/90 bg-white flex items-center px-8 justify-between shrink-0 shadow-xs z-20">
        <div className="flex items-center gap-3">
          <div className="w-4 h-4 rounded-full bg-[#1a73e8] shadow-[0_0_8px_rgba(26,115,232,0.4)]" />
          <h1 className="text-[#202124] font-bold tracking-tight text-base flex items-center gap-2">
            <span>DropIn.ai</span>
            <span className="text-neutral-300 font-light">|</span>
            <span className="text-[#5f6368] font-normal text-sm">Enterprise Supply Chain Middleware</span>
          </h1>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#f8f9fa] border border-neutral-200 text-xs text-[#5f6368]">
            <span className="w-2 h-2 rounded-full bg-[#34a853]" />
            <span>SAP S/4HANA EDI Gateway Connected</span>
          </div>

          <Link
            href="/erp-simulator"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-300 hover:bg-neutral-100 text-xs font-medium text-[#202124] transition-colors"
          >
            <span>Launch SAP S/4HANA</span>
          </Link>

          <button
            onClick={() => setPanelOpen(!panelOpen)}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1a73e8] hover:bg-[#1557b0] text-white text-xs font-semibold tracking-wide transition-all shadow-sm cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{panelOpen ? "Close Analysis Console" : "Open Analysis Console"}</span>
          </button>
        </div>
      </header>
      
      {/* 3D WebGL Canvas Area & Side Panel */}
      <div className="flex-1 relative bg-[#f8f9fa]">
        <ThreeDBudsPro onPmicClick={() => setPanelOpen(true)} />
        <AIPanel isOpen={panelOpen} />
      </div>
    </main>
  );
}
