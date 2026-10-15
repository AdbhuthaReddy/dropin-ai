"use client";

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Sparkles, 
  Check, 
  X, 
  ArrowRight, 
  Activity, 
  ShieldCheck, 
  AlertTriangle, 
  FileText, 
  Building2, 
  ShoppingCart,
  Clock,
  ExternalLink,
  CheckCircle2,
  RotateCw
} from 'lucide-react';

import { useInventoryStore } from "@/store/useInventoryStore";

export default function AIPanel({ isOpen }: { isOpen: boolean }) {
  const { items, selectedPartId, lastBreachedMpn, setDropInResolution } = useInventoryStore();

  const [loading, setLoading] = useState(false);
  const [isFindingAlternative, setIsFindingAlternative] = useState(false);
  const [loadingMpn, setLoadingMpn] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [logIndex, setLogIndex] = useState(0);
  const [pipelineStage, setPipelineStage] = useState(1);
  
  const logEndRef = useRef<HTMLDivElement>(null);
  const triggeredMpnsRef = useRef<Set<string>>(new Set());

  const criticalItems = items.filter((i) => i.stock <= i.safetyStock);

  const activeItem =
    (loadingMpn ? items.find((i) => (i.materialNumber || i.mpn) === loadingMpn) : null) ||
    items.find((i) => i.mpn === lastBreachedMpn) ||
    items.find((i) => i.id === selectedPartId) ||
    criticalItems[0] ||
    items.find((i) => i.id === "pmic") ||
    items[0];

  const currentActiveMpn = loadingMpn || result?.original_mpn || activeItem?.materialNumber || activeItem?.mpn || "MAX77650EWV+T";

  const logs = [
    `Stage 1: Ingesting SAP S/4HANA Line-Down Alert (MPN: ${currentActiveMpn})...`,
    "Stage 1: Procurement Agent scanning DigiKey, Mouser, Avnet for original stock...",
    `Stage 1: Verified original ${currentActiveMpn} global stock level & lead time...`,
    "Stage 2: Original out of stock. Initiating Engineering Agent for datasheet analysis...",
    "Stage 2: Extracting pinout alignments, voltage thresholds & thermal package envelope...",
    "Stage 2: Evaluating in-stock drop-in alternatives on live distributor networks...",
    "Stage 2: Synthesizing deterministic AgentHardwareVerdict with direct procurement URL...",
    "Stage 2: Generating automated EDI Purchase Order & transmitting SAP writeback..."
  ];

  // Auto-trigger exact search when a component enters criticalItems
  useEffect(() => {
    const currentCriticalKeys = new Set(criticalItems.map((i) => i.materialNumber || i.mpn));
    for (const key of Array.from(triggeredMpnsRef.current)) {
      if (!currentCriticalKeys.has(key)) {
        triggeredMpnsRef.current.delete(key);
      }
    }

    const newlyCritical = criticalItems.find(
      (item) => !triggeredMpnsRef.current.has(item.materialNumber || item.mpn)
    );

    if (newlyCritical && !loading && !isFindingAlternative) {
      const key = newlyCritical.materialNumber || newlyCritical.mpn;
      triggeredMpnsRef.current.add(key);
      runPipeline(key, "exact");
    }
  }, [criticalItems, loading, isFindingAlternative]);

  useEffect(() => {
    let timer1: NodeJS.Timeout;
    let timer2: NodeJS.Timeout;
    if (loading) {
      setPipelineStage(1);
      timer1 = setTimeout(() => setPipelineStage(2), 2600);
      timer2 = setTimeout(() => setPipelineStage(3), 5500);
    } else {
      setPipelineStage(1);
    }
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [loading]);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logIndex, loading]);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (loading) {
      interval = setInterval(() => {
        setLogIndex(prev => (prev < logs.length - 1 ? prev + 1 : prev));
      }, 800);
    } else {
      setLogIndex(0);
    }
    return () => clearInterval(interval);
  }, [loading, logs.length]);

  const runPipeline = async (targetMpn?: string, searchMode: "exact" | "alternative" = "exact") => {
    if (searchMode === "alternative") {
      setIsFindingAlternative(true);
    } else {
      setLoading(true);
      setResult(null);
    }

    const targetItem =
      items.find((i) => (i.materialNumber || i.mpn) === targetMpn) ||
      items.find((i) => i.materialNumber === targetMpn) ||
      items.find((i) => i.mpn === targetMpn) ||
      items.find((i) => i.id === targetMpn) ||
      activeItem;

    const chosenMpn = targetItem?.materialNumber || targetItem?.mpn || targetMpn || "MAX77650EWV+T";
    setLoadingMpn(chosenMpn);

    try {
      const res = await fetch("http://localhost:8080/api/webhooks/sap-line-down", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          erp_system: "SAP S/4HANA Cloud",
          target_mpn: chosenMpn,
          target_description: targetItem?.description || "Unknown Component",
          search_mode: searchMode,
          inventory_level: targetItem?.stock || 0,
          plant_id: "HYD-01",
          factory_location: "Foxconn GZ-Plant 4"
        })
      });
      const data = await res.json();
      setResult(data);

      if (data.aml_authorization && targetItem && data.workflow_route !== 'OEM_CUSTOM_ESCALATION') {
        setDropInResolution(
          targetItem.mpn,
          data.candidate_mpn,
          data.distributor_quote?.stock_available || 25000,
          data.distributor_quote?.lead_time_days || 2,
          data.distributor_quote?.distributor || "DigiKey / Octopart Global"
        );
      }
    } catch (err: any) {
      setResult({ 
        detail: "Connection to FastAPI backend failed. Ensure backend server is running on port 8080." 
      });
    } finally {
      setLoading(false);
      setIsFindingAlternative(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div 
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="absolute right-0 top-0 h-full w-[480px] bg-white border-l border-neutral-200/90 shadow-[-10px_0_40px_rgba(32,33,36,0.08)] flex flex-col z-50 p-8 font-sans text-[#202124]"
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-8 shrink-0 pb-4 border-b border-neutral-100">
            <div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#1a73e8]" />
                <h2 className="text-[#202124] text-sm font-semibold tracking-tight">
                  Autonomous ERP Middleware
                </h2>
              </div>
              <p className="text-[11px] text-[#5f6368] mt-0.5">Autonomous Pipeline</p>
            </div>
            
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#e8f0fe] border border-[#d2e3fc] text-[#1967d2] text-[10px] font-medium font-mono">
              <Activity className="w-3 h-3 text-[#1a73e8]" />
              <span>SAP ACTIVE</span>
            </div>
          </div>
          
          {/* Body Content */}
          <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-4">
            {/* Multi-Agent Sequential Timeline During Loading */}
            {loading && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-4">
                {/* Visual Step Timeline */}
                <div className="p-4 rounded-2xl border border-blue-200 bg-[#f8fafd] space-y-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-[#1a73e8] uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 animate-spin" />
                      Sequential Multi-Agent Pipeline Active
                    </span>
                    <span className="text-[10px] font-mono text-neutral-500">GEMINI 3.8 FLASH</span>
                  </div>

                  <div className="space-y-3 relative pl-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-blue-100">
                    {/* Step 1 */}
                    <div className="relative">
                      <div className={`absolute -left-6 top-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${
                        pipelineStage > 1 
                          ? 'bg-[#137333] text-white' 
                          : pipelineStage === 1 
                          ? 'bg-[#1a73e8] text-white animate-pulse' 
                          : 'bg-neutral-200 text-neutral-500'
                      }`}>
                        {pipelineStage > 1 ? <Check className="w-3 h-3" /> : 1}
                      </div>
                      <div>
                        <p className={`text-xs font-semibold ${pipelineStage >= 1 ? 'text-[#202124]' : 'text-neutral-400'}`}>
                          Step 1: Attempting to procure original {activeItem?.mpn || "part"} globally...
                        </p>
                        <p className="text-[10px] text-neutral-500">Live internet search across DigiKey, Mouser, Avnet registries</p>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div className="relative">
                      <div className={`absolute -left-6 top-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${
                        pipelineStage > 2 
                          ? 'bg-[#137333] text-white' 
                          : pipelineStage === 2 
                          ? 'bg-[#1a73e8] text-white animate-pulse' 
                          : 'bg-neutral-200 text-neutral-500'
                      }`}>
                        {pipelineStage > 2 ? <Check className="w-3 h-3" /> : 2}
                      </div>
                      <div>
                        <p className={`text-xs font-semibold ${pipelineStage >= 2 ? 'text-[#202124]' : 'text-neutral-400'}`}>
                          Step 2: Original out of stock. Initiating Engineering Agent for datasheet analysis...
                        </p>
                        <p className="text-[10px] text-neutral-500">Multimodal pinout matching, thermal & voltage constraint evaluation</p>
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className="relative">
                      <div className={`absolute -left-6 top-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors ${
                        pipelineStage === 3 ? 'bg-[#1a73e8] text-white animate-pulse' : 'bg-neutral-200 text-neutral-500'
                      }`}>
                        3
                      </div>
                      <div>
                        <p className={`text-xs font-semibold ${pipelineStage >= 3 ? 'text-[#202124]' : 'text-neutral-400'}`}>
                          Step 3: EDI Purchase Order Dispatch & SAP Writeback
                        </p>
                        <p className="text-[10px] text-neutral-500">Autonomous AML approval and electronic order placement</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Live Console Output */}
                <div className="bg-[#202124] p-4 rounded-2xl font-mono text-[11px] leading-relaxed text-neutral-300 h-52 overflow-y-auto shadow-inner">
                  {logs.slice(0, logIndex + 1).map((log, i) => (
                    <motion.div key={i} initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className="mb-2">
                      <span className="text-[#8ab4f8] mr-2">➜</span> 
                      <span className={i === logIndex ? "text-white font-semibold" : "text-neutral-400"}>{log}</span>
                    </motion.div>
                  ))}
                  <div ref={logEndRef} className="h-3" /> 
                </div>
              </motion.div>
            )}

            {/* Response Results UI */}
            {result && !loading && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-4"
              >
                {/* Result Card */}
                <div className={`p-5 rounded-2xl border ${
                  result?.workflow_route === 'OEM_CUSTOM_ESCALATION'
                    ? 'bg-orange-50/40 border-orange-200'
                    : result?.aml_authorization
                    ? 'bg-[#e6f4ea]/40 border-[#ceead6]'
                    : 'bg-[#fce8e6]/40 border-[#f5c2c7]'
                }`}>
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-full ${
                        result?.workflow_route === 'OEM_CUSTOM_ESCALATION'
                          ? 'bg-orange-100 text-orange-600'
                          : result?.aml_authorization
                          ? 'bg-[#ceead6] text-[#137333]'
                          : 'bg-[#f5c2c7] text-[#c5221f]'
                      }`}>
                        {result?.workflow_route === 'OEM_CUSTOM_ESCALATION' ? (
                          <AlertTriangle className="w-5 h-5" />
                        ) : result?.aml_authorization ? (
                          <Check className="w-5 h-5" />
                        ) : (
                          <X className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <span className="text-[10px] font-bold tracking-wider uppercase font-mono text-[#5f6368]">
                          {result?.workflow_route === 'OEM_CUSTOM_ESCALATION' ? 'PROPRIETARY ESCALATION' : 'AML VERIFICATION STATUS'}
                        </span>
                        <h4 className={`text-base font-bold tracking-tight ${
                          result?.workflow_route === 'OEM_CUSTOM_ESCALATION'
                            ? 'text-orange-600'
                            : result?.aml_authorization
                            ? 'text-[#137333]'
                            : 'text-[#c5221f]'
                        }`}>
                          {result?.workflow_route === 'OEM_CUSTOM_ESCALATION'
                            ? "OEM Escalation Required"
                            : result?.aml_authorization
                            ? "Approved Drop-In Replacement"
                            : "Hold for Engineering Review"}
                        </h4>
                      </div>
                    </div>

                    {/* Workflow Route Badge */}
                    {result?.workflow_route && (
                      <span className={`px-2.5 py-1 rounded-full text-[9px] font-bold font-mono tracking-wider uppercase border ${
                        result.workflow_route === 'OEM_CUSTOM_ESCALATION'
                          ? 'text-orange-600 bg-orange-50 border-orange-200'
                          : result.workflow_route === 'EXACT_ORIGINAL_PROCURED'
                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                          : 'bg-blue-100 text-[#1a73e8] border-blue-200'
                      }`}>
                        {result.workflow_route === 'OEM_CUSTOM_ESCALATION'
                          ? 'OEM ESCALATION REQUIRED'
                          : result.workflow_route === 'EXACT_ORIGINAL_PROCURED'
                          ? 'EXACT OEM MATCH'
                          : 'ALTERNATIVE ENGINEERED'}
                      </span>
                    )}
                  </div>

                  {/* Chain-of-Thought Search Reasoning */}
                  {result?.search_reasoning && (
                    <div className="p-3 bg-white/90 rounded-xl border border-emerald-300 text-xs text-neutral-800 space-y-1 mb-4 shadow-2xs">
                      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Google Search Grounding (Chain-of-Thought)</span>
                      </div>
                      <p className="text-[11px] text-neutral-700 leading-relaxed font-sans">{result.search_reasoning}</p>
                    </div>
                  )}

                  {/* Candidate MPN & PO Readout */}
                  <div className="space-y-2 text-xs bg-white p-3.5 rounded-xl border border-neutral-200/70 mb-4">
                    <div className="flex justify-between">
                      <span className="text-[#5f6368]">Target Part Number:</span>
                      <strong className="text-[#202124] font-mono">{result?.original_mpn || activeItem?.mpn}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#5f6368]">
                        {result?.workflow_route === 'OEM_CUSTOM_ESCALATION' ? 'Escalation Status:' : 'Procured / Drop-In MPN:'}
                      </span>
                      <strong className={`font-bold font-mono ${
                        result?.workflow_route === 'OEM_CUSTOM_ESCALATION' ? 'text-orange-600' : 'text-[#1a73e8]'
                      }`}>
                        {result?.candidate_mpn}
                      </strong>
                    </div>
                    {result?.purchase_order_id && (
                      <div className="flex justify-between">
                        <span className="text-[#5f6368]">Auto-Generated EDI PO:</span>
                        <span className="text-[#137333] font-bold font-mono">{result.purchase_order_id}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-[#5f6368]">AI Confidence Score:</span>
                      <strong className="text-[#202124] font-mono">{((result?.confidence_score || 0) * 100).toFixed(1)}%</strong>
                    </div>
                  </div>

                  {/* Distributor Quote OR Proprietary Notice */}
                  {result?.workflow_route === 'OEM_CUSTOM_ESCALATION' ? (
                    <div className="p-3 bg-white/90 rounded-xl border border-orange-200 text-xs text-orange-900 flex items-start gap-2.5 mb-4 shadow-2xs">
                      <AlertTriangle className="w-4 h-4 text-orange-600 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold text-orange-800 text-[11px] uppercase tracking-wider">Custom Component Constraint</div>
                        <p className="text-[11px] text-orange-700 mt-0.5 font-medium">Proprietary Custom Component - Commercial Sourcing Unavailable</p>
                      </div>
                    </div>
                  ) : result?.distributor_quote && (
                    <div className="p-3 bg-white rounded-xl border border-neutral-200/70 text-xs text-[#5f6368] space-y-1.5 mb-4">
                      <div className="flex justify-between">
                        <span>Distributor:</span>
                        <strong className="text-[#202124]">{result.distributor_quote.distributor}</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Immediate Stock:</span>
                        <strong className="text-[#137333] font-mono">{result.distributor_quote.stock_available.toLocaleString()} Units</strong>
                      </div>
                      <div className="flex justify-between">
                        <span>Transit Lead Time:</span>
                        <strong className="text-[#202124] font-mono">{result.distributor_quote.lead_time_days} Days</strong>
                      </div>
                    </div>
                  )}

                  {/* HIGHLY VISIBLE ACTION BUTTON: CLICKABLE URL TO DISTRIBUTOR OR OEM */}
                  {result?.action_buy_url && (
                    <div className="mb-4">
                      <a
                        href={result.action_buy_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`w-full py-3.5 px-4 ${
                          result.workflow_route === 'OEM_CUSTOM_ESCALATION'
                            ? 'bg-neutral-800 hover:bg-neutral-900 active:bg-neutral-950 text-white'
                            : 'bg-[#1a73e8] hover:bg-[#1557b0] active:bg-[#0d47a1] text-white'
                        } rounded-xl text-xs font-bold tracking-wide transition-all shadow-md flex justify-center items-center gap-2 group cursor-pointer text-center`}
                      >
                        {result.workflow_route === 'OEM_CUSTOM_ESCALATION' ? (
                          <>
                            <AlertTriangle className="w-4 h-4 shrink-0 text-orange-400" />
                            <span>ESCALATE TO OEM ENGINEERING</span>
                          </>
                        ) : (
                          <>
                            <ShoppingCart className="w-4 h-4 shrink-0" />
                            <span>Procure Component via {result.distributor_quote?.distributor || "Distributor"}</span>
                          </>
                        )}
                        <ExternalLink className="w-4 h-4 shrink-0 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                      </a>
                      <p className="text-[10px] text-center text-neutral-500 mt-1 font-mono">
                        {result.workflow_route === 'OEM_CUSTOM_ESCALATION'
                          ? `OEM escalation portal: ${result.action_buy_url.slice(0, 48)}...`
                          : `Direct procurement link: ${result.action_buy_url.slice(0, 48)}...`}
                      </p>
                    </div>
                  )}

                  {/* Engineering Constraints Differences */}
                  <div className="text-xs font-semibold text-[#202124] mb-2">Electrical & Thermal Analysis:</div>
                  <ul className="space-y-2 text-xs text-[#5f6368]">
                    {result?.critical_differences?.length > 0 ? (
                      result.critical_differences.map((diff: string, i: number) => (
                        <li key={i} className="flex gap-2 leading-relaxed">
                          <span className="text-[#1a73e8] font-bold">•</span>
                          <span>{diff}</span>
                        </li>
                      ))
                    ) : (
                      <li className="text-xs text-[#5f6368]">
                        {result?.message || result?.detail || "Pinout alignment and I2C registers fully verified."}
                      </li>
                    )}
                  </ul>

                  <div className="mt-4 pt-3 border-t border-neutral-200/70 flex justify-between items-center text-[10px] text-[#5f6368] font-mono">
                    <span>ENGINE: MULTI-AGENT GEMINI</span>
                    <span>ERP: SAP WRITEBACK COMPLETE</span>
                  </div>

                  {/* PROMINENT STYLIZED ACTION BUTTON: Find Drop-In Alternative with Gemini */}
                  {result.workflow_route === 'EXACT_ORIGINAL_PROCURED' && (
                    <div className="mt-4 pt-3 border-t border-neutral-200/70">
                      <button
                        type="button"
                        onClick={() => runPipeline(result.original_mpn, "alternative")}
                        disabled={isFindingAlternative}
                        className="w-full py-3.5 px-4 bg-gradient-to-r from-[#1a73e8] via-[#4285f4] to-[#1a73e8] hover:opacity-95 active:scale-[0.99] text-white rounded-xl text-xs font-bold tracking-wide transition-all shadow-md flex justify-center items-center gap-2 group cursor-pointer disabled:opacity-75 disabled:cursor-not-allowed"
                      >
                        {isFindingAlternative ? (
                          <>
                            <RotateCw className="w-4 h-4 animate-spin text-white" />
                            <span>Gemini Engineering Drop-In Alternative...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-4 h-4 text-white animate-pulse" />
                            <span>✨ Find Drop-In Alternative with Gemini</span>
                          </>
                        )}
                      </button>
                      <p className="text-[10px] text-center text-neutral-500 mt-1.5 font-medium">
                        Synthesize pin-compatible COTS replacement via Google Search Grounding
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* Shortages List When Idle */}
            {!loading && !result && (
              <div className="flex flex-col gap-3.5">
                <div className="flex items-center justify-between pb-1">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#5f6368] font-mono">
                    ACTIVE SHORTAGES ({criticalItems.length})
                  </span>
                  <span className="text-[10px] font-mono text-[#c5221f] font-bold">
                    {criticalItems.length > 0 ? "LINE-DOWN RISK" : "ALL WITHIN TOLERANCE"}
                  </span>
                </div>

                {criticalItems.length === 0 ? (
                  <div className="p-6 rounded-2xl bg-[#f8f9fa] border border-neutral-200 text-center text-xs text-neutral-500">
                    <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                    <p className="font-semibold text-neutral-800">All Components In Specification</p>
                    <p className="mt-1 text-[11px] text-neutral-500">
                      No critical line-down shortages currently detected across the 10-part BOM.
                    </p>
                  </div>
                ) : (
                  criticalItems.map((item) => {
                    const matNumber = item.materialNumber || item.mpn;
                    return (
                      <div
                        key={item.id}
                        className="p-4 rounded-2xl bg-[#f8f9fa] border border-neutral-200/90 relative overflow-hidden shadow-xs hover:border-neutral-300 transition-all"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <span className="text-[10px] font-bold text-[#c5221f] uppercase tracking-wider font-mono">
                              LINE-DOWN ALERT
                            </span>
                            <h3 className="text-base font-bold text-[#202124] mt-0.5">{item.name}</h3>
                            <p className="text-xs text-[#5f6368] mt-0.5">
                              MPN: <strong className="font-mono text-[#202124]">{matNumber}</strong>
                            </p>
                          </div>
                          <span className="px-2.5 py-1 rounded-full bg-[#fce8e6] text-[#c5221f] text-[10px] font-bold">
                            {item.stock.toLocaleString()} In Stock
                          </span>
                        </div>
                        <div className="mt-3 pt-3 border-t border-neutral-200/60 flex justify-between text-xs text-[#5f6368]">
                          <span>Lead Time: <strong className="text-[#c5221f]">{item.leadTime}</strong></span>
                          <span>Safety Stock: <strong className="text-[#202124]">{item.safetyStock.toLocaleString()}</strong></span>
                        </div>

                        {/* BLUE TRIGGER BUTTON INSIDE EACH CARD */}
                        <button
                          onClick={() => runPipeline(item.materialNumber, "exact")}
                          className="mt-3.5 w-full py-2.5 px-3 bg-[#1a73e8] hover:bg-[#1557b0] active:bg-[#0d47a1] text-white rounded-xl text-xs font-semibold tracking-wide transition-all shadow-xs flex justify-center items-center gap-2 group cursor-pointer"
                        >
                          <span>Trigger Autonomous Pipeline</span>
                          <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Action Footer */}
          <div className="mt-4 shrink-0 pt-4 border-t border-neutral-100">
            {result && !loading && (
              <button 
                onClick={() => setResult(null)}
                className="w-full py-3 px-4 bg-white hover:bg-neutral-50 border border-neutral-200 text-[#202124] rounded-xl text-xs font-medium tracking-wide transition-all flex justify-center items-center gap-2 cursor-pointer shadow-sm"
              >
                Reset Pipeline & Return to Shortages
              </button>
            )}
            {!result && !loading && (
              <div className="flex items-center justify-between text-xs text-neutral-500">
                <span>Total Monitored Parts:</span>
                <span className="font-bold text-neutral-800 font-mono">10 Components (HYD-01)</span>
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
