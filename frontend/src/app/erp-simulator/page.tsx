"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import {
  AlertOctagon,
  CheckCircle2,
  AlertTriangle,
  RotateCw,
  Search,
  SlidersHorizontal,
  Download,
  Share2,
  Printer,
  ChevronRight,
  ShieldCheck,
  Building2,
  Cpu,
  Layers,
  ExternalLink,
  Info,
  Clock,
  ArrowRight,
  FileCheck,
  Edit3,
  TrendingDown,
  RefreshCcw,
  ShoppingCart,
  Check,
  Sparkles,
  X
} from "lucide-react";
import { useInventoryStore, InventoryItem } from "@/store/useInventoryStore";

interface ERPWritebackResponse {
  workflow_route?: string;
  action_buy_url?: string;
  search_reasoning?: string;
  original_mpn: string;
  candidate_mpn: string;
  aml_authorization: boolean;
  confidence_score: number;
  procurement_status: string;
  purchase_order_id: string | null;
  engineering_flags?: string[];
  critical_differences: string[];
  distributor_quote?: {
    distributor: string;
    stock_available: number;
    unit_price_usd: number;
    lead_time_days: number;
  };
  message: string;
  timestamp: string;
}

export default function ERPSimulatorPage() {
  const {
    items,
    updateStock,
    setDropInResolution,
    markResolved,
    resetAll,
    simulateShortage,
    lastBreachedMpn
  } = useInventoryStore();

  const [mounted, setMounted] = useState(false);
  const [isDispatching, setIsDispatching] = useState<boolean>(false);
  const [dispatchingMpn, setDispatchingMpn] = useState<string | null>(null);
  const [dispatchStage, setDispatchStage] = useState<number>(1);
  const [toastMessage, setToToastMessage] = useState<string | null>(null);
  const [writebackResponse, setWritebackResponse] = useState<ERPWritebackResponse | null>(null);
  const [selectedFilter, setSelectedFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedBreachMpn, setSelectedBreachMpn] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let t1: NodeJS.Timeout;
    let t2: NodeJS.Timeout;
    if (isDispatching) {
      setDispatchStage(1);
      t1 = setTimeout(() => setDispatchStage(2), 2600);
      t2 = setTimeout(() => setDispatchStage(3), 5500);
    } else {
      setDispatchStage(1);
    }
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [isDispatching]);

  // Compute all critical items: breached items OR items resolved with an AI verdict
  const criticalItems = items.filter(
    (item) => item.stock <= item.safetyStock || (item.isResolved && item.aiVerdict)
  );
  const unresolvedItems = criticalItems.filter((item) => !item.isResolved);
  const breachedItems = items.filter((item) => item.stock <= item.safetyStock);

  // Determine active component to target for the webhook dispatch
  const activeTargetItem =
    unresolvedItems.find((i) => i.mpn === selectedBreachMpn) ||
    unresolvedItems.find((i) => i.mpn === lastBreachedMpn) ||
    unresolvedItems[0] ||
    items.find((i) => i.id === "pmic") ||
    items[0];

  const handleDispatchWebhook = async (targetOverride?: InventoryItem) => {
    const target = targetOverride || activeTargetItem;
    if (!target) return;

    setDispatchingMpn(target.materialNumber || target.mpn);
    setIsDispatching(true);
    setWritebackResponse(null);
    setToToastMessage(
      `Autonomous Pipeline Dispatched for ${target.materialNumber || target.mpn}. Awaiting AML Authorization...`
    );

    const payload = {
      erp_system: "SAP S/4HANA",
      plant_id: "HYD-01",
      target_mpn: target.materialNumber || target.mpn,
      target_description: target.description,
      search_mode: "alternative",
      inventory_level: target.stock,
      lead_time_weeks: parseInt(target.leadTime) || 12
    };

    try {
      const response = await fetch("http://localhost:8080/api/webhooks/sap-line-down", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data: ERPWritebackResponse = await response.json();
      setWritebackResponse(data);
      setToToastMessage(`SAP EDI Response Received: ${data.procurement_status}`);

      // Save verdict globally in Zustand
      markResolved(target.materialNumber || target.mpn, data);

      // Reflect replacement in the global Zustand store
      if (data.aml_authorization && data.workflow_route !== 'OEM_CUSTOM_ESCALATION') {
        setDropInResolution(
          target.mpn,
          data.candidate_mpn,
          data.distributor_quote?.stock_available || 25000,
          data.distributor_quote?.lead_time_days || 2,
          data.distributor_quote?.distributor || "DigiKey / Octopart Global"
        );
      }
    } catch (err: any) {
      console.error("Autonomous Pipeline error:", err);
      setToToastMessage(
        "Autonomous Pipeline error: Unable to connect to DropIn.ai agent on localhost:8080. Ensure backend is active."
      );
    } finally {
      setIsDispatching(false);
      setDispatchingMpn(null);
    }
  };

  const filteredItems = items.filter((r) => {
    if (selectedFilter === "EXCEPTIONS" && r.stock > r.safetyStock) return false;
    if (selectedFilter === "LINE_DOWN" && r.stock > 0) return false;
    if (selectedFilter === "NORMAL" && r.stock <= r.safetyStock) return false;
    if (
      searchQuery.trim() !== "" &&
      !r.mpn.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !r.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !r.vendor.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  if (!mounted) {
    return (
      <div className="min-h-screen bg-[#f4f4f4] flex items-center justify-center font-sans text-neutral-500">
        Loading SAP S/4HANA Materials Management...
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-[#f4f4f4] text-[#333333] flex flex-col"
      style={{ fontFamily: "Arial, Helvetica, sans-serif" }}
    >
      {/* =========================================================================
          SAP FIORI SHELL HEADER BAR
          ========================================================================= */}
      <header className="h-[48px] bg-[#0a6ed1] text-white flex items-center justify-between px-4 shrink-0 shadow-sm border-b border-[#0854a0] select-none">
        <div className="flex items-center gap-3">
          {/* SAP Emblem */}
          <div className="bg-[#0854a0] px-2 py-0.5 text-[11px] font-bold tracking-wider rounded-none border border-[#1b7cdb]">
            SAP
          </div>
          <div className="h-4 w-[1px] bg-white/20" />
          <h1 className="text-[13px] font-semibold tracking-normal text-white flex items-center gap-2">
            <span>SAP S/4HANA</span>
            <span className="text-white/40">|</span>
            <span className="text-white/90 font-normal">Materials Management - Plant HYD-01</span>
          </h1>
        </div>

        {/* Shell Navigation & Right Actions */}
        <div className="flex items-center gap-3 text-[12px]">
          <div className="hidden md:flex items-center gap-2 text-white/80 text-[11px] bg-[#0854a0] px-2.5 py-1 border border-white/10">
            <span>Client: 100</span>
            <span>•</span>
            <span>Sys: PRD</span>
            <span>•</span>
            <span>Plant: HYD-01</span>
            <span>•</span>
            <span>MRP: Active</span>
          </div>

          <Link
            href="/"
            className="flex items-center gap-1.5 px-3 py-1 bg-white text-[#0a6ed1] hover:bg-[#eaf3fc] font-bold text-[11px] uppercase tracking-wider transition-colors shadow-xs"
            title="Launch DropIn.ai 3D Exploded Twin"
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>DropIn.ai 3D Twin</span>
            {breachedItems.length > 0 && (
              <span className="bg-red-500 text-white text-[9px] px-1.5 py-0.2 rounded-full font-bold ml-0.5">
                {breachedItems.length}
              </span>
            )}
            <ExternalLink className="w-3 h-3 ml-0.5" />
          </Link>
        </div>
      </header>

      {/* =========================================================================
          FIORI SUB-HEADER & QUICK TEST TOOLBAR
          ========================================================================= */}
      <div className="bg-white border-b border-[#cccccc] px-6 py-2.5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-1 text-[11px] text-[#666666] mb-0.5">
            <span>Home</span>
            <ChevronRight className="w-3 h-3" />
            <span>Manufacturing Logistics</span>
            <ChevronRight className="w-3 h-3" />
            <span>Plant HYD-01 (Foxconn Hyderabad)</span>
            <ChevronRight className="w-3 h-3" />
            <span className="text-[#333333] font-semibold">Stock Monitor</span>
          </div>
          <div className="flex items-center gap-3">
            <h2 className="text-[16px] font-bold text-[#222222]">
              Stock Overview & Safety Threshold Monitor: Pixel Buds Pro 2 (GRVCC)
            </h2>
          </div>
        </div>

        {/* Quick Testing Actions for Judges */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#666666] font-semibold">Quick Test:</span>
          <button
            onClick={() => simulateShortage("pmic")}
            className="px-2 py-1 bg-[#fff3e0] hover:bg-[#ffe0b2] border border-[#ffb74d] text-[11px] text-[#b71c1c] font-semibold cursor-pointer"
          >
            Drop PMIC
          </button>
          <button
            onClick={() => simulateShortage("battery")}
            className="px-2 py-1 bg-[#fff3e0] hover:bg-[#ffe0b2] border border-[#ffb74d] text-[11px] text-[#b71c1c] font-semibold cursor-pointer"
          >
            Drop Battery
          </button>
          <button
            onClick={() => simulateShortage("tensor-a1")}
            className="px-2 py-1 bg-[#fff3e0] hover:bg-[#ffe0b2] border border-[#ffb74d] text-[11px] text-[#b71c1c] font-semibold cursor-pointer"
          >
            Drop Tensor A1
          </button>
          <button
            onClick={resetAll}
            className="flex items-center gap-1 px-2.5 py-1 bg-white border border-[#cccccc] hover:bg-[#f9f9f9] text-[11px] text-[#333333] cursor-pointer"
            title="Reset simulation state to original stock numbers"
          >
            <RotateCw className="w-3 h-3 text-[#666666]" />
            <span>Reset All</span>
          </button>
        </div>
      </div>

      {/* =========================================================================
          MAIN WORKSPACE CONTAINER
          ========================================================================= */}
      <main className="flex-1 w-full max-w-[1440px] mx-auto p-6 flex flex-col gap-5">
        {/* =======================================================================
            TOAST / STATE MESSAGE NOTIFICATION BANNER
            ======================================================================= */}
        {toastMessage && (
          <div
            className={`px-4 py-2.5 text-[12px] flex items-center justify-between border ${
              isDispatching
                ? "bg-[#fff8e1] border-[#ffe082] text-[#8d6e00]"
                : writebackResponse?.aml_authorization
                ? "bg-[#e8f5e9] border-[#a5d6a7] text-[#1b5e20]"
                : "bg-[#e3f2fd] border-[#90caf9] text-[#0d47a1]"
            }`}
          >
            <div className="flex items-center gap-2">
              {isDispatching ? (
                <RotateCw className="w-4 h-4 animate-spin text-[#ff8f00]" />
              ) : writebackResponse?.aml_authorization ? (
                <CheckCircle2 className="w-4 h-4 text-[#2e7d32]" />
              ) : (
                <Info className="w-4 h-4 text-[#0a6ed1]" />
              )}
              <span className="font-semibold">{toastMessage}</span>
            </div>
            {writebackResponse && (
              <span className="text-[11px] opacity-80 font-mono">
                {new Date(writebackResponse.timestamp).toLocaleTimeString()}
              </span>
            )}
          </div>
        )}

        {/* =======================================================================
            EXCEPTIONS LOG ALERT BANNERS (RENDERED FOR ANY !item.isResolved SHORTAGES)
            ======================================================================= */}
        {criticalItems
          .filter((item) => !item.isResolved)
          .map((item) => (
            <section key={'exception-' + item.id} className="bg-white border-2 border-[#d32f2f] p-4 shadow-xs">
              <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-[#ffebee] border border-[#ffcdd2] text-[#c62828] shrink-0 mt-0.5">
                    <AlertOctagon className="w-5 h-5 text-[#d32f2f]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-[13px] font-bold text-[#b71c1c] uppercase tracking-wide">
                        Exceptions Log: Safety Stock Breach Detected
                      </h3>
                      <span className="bg-[#b71c1c] text-white text-[10px] font-bold px-1.5 py-0.2 tracking-wider">
                        CRITICAL MRP ESCALATION
                      </span>
                    </div>

                    <p className="text-[12px] text-[#444444] mt-1 leading-snug">
                      Target component <strong className="text-[#b71c1c]">{item.materialNumber}</strong> ({item.name})
                      has depleted to <strong className="text-[#b71c1c]">{item.stock.toLocaleString()} EA</strong>,
                      breaching the safety stock threshold of <strong className="text-[#222222]">{item.safetyStock.toLocaleString()} EA</strong> (Lead Time: {item.leadTime}).
                    </p>

                    <p className="text-[11px] text-[#777777] mt-1.5">
                      Automated Rule: Trigger Autonomous Pipeline with target MPN for immediate secondary market cross-reference & AML verification.
                    </p>
                  </div>
                </div>

                {/* PRIMARY ENTERPRISE BUTTON (SQUARE CORNERS, SAP BLUE #0a6ed1) */}
                <div className="shrink-0 flex items-center gap-2 w-full lg:w-auto">
                  <button
                    type="button"
                    onClick={() => handleDispatchWebhook(item)}
                    disabled={isDispatching}
                    className="w-full lg:w-auto px-5 py-2.5 bg-[#0a6ed1] hover:bg-[#0854a0] active:bg-[#064380] disabled:bg-[#90caf9] text-white font-bold text-[12px] uppercase tracking-wider transition-colors shadow-xs flex items-center justify-center gap-2 rounded-none cursor-pointer border border-[#0854a0]"
                  >
                    {isDispatching && dispatchingMpn === item.materialNumber ? (
                      <>
                        <RotateCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Running Autonomous Pipeline...</span>
                      </>
                    ) : (
                      <>
                        <Share2 className="w-3.5 h-3.5" />
                        <span>Trigger Autonomous Pipeline for {item.materialNumber}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* MULTI-STEP TIMELINE DURING DISPATCH */}
              {isDispatching && dispatchingMpn === item.materialNumber && (
                <div className="mt-3 pt-3 border-t border-[#ef9a9a] bg-white p-3.5 border border-[#ffcdd2]">
                  <div className="flex items-center justify-between mb-3 pb-1.5 border-b border-[#f0f0f0]">
                    <span className="text-[11px] font-bold text-[#0a6ed1] uppercase tracking-wide flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 animate-spin text-[#0a6ed1]" />
                      Multi-Agent Sequential Pipeline in Progress
                    </span>
                    <span className="text-[10px] font-mono text-[#777777]">GEMINI 3.8 FLASH WITH SEARCH GROUNDING</span>
                  </div>

                  <div className="space-y-2.5">
                    {/* Step 1 */}
                    <div className="flex items-start gap-2.5">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors ${
                        dispatchStage > 1 ? 'bg-[#2e7d32] text-white' : dispatchStage === 1 ? 'bg-[#0a6ed1] text-white animate-pulse' : 'bg-[#e0e0e0] text-[#777777]'
                      }`}>
                        {dispatchStage > 1 ? <Check className="w-3 h-3" /> : 1}
                      </div>
                      <div>
                        <span className={`text-[11px] font-bold ${dispatchStage >= 1 ? 'text-[#222222]' : 'text-[#888888]'}`}>
                          Step 1: Attempting to procure original {item.materialNumber} globally...
                        </span>
                        <p className="text-[10px] text-[#666666]">
                          Querying live stock and lead times across DigiKey, Mouser, and Avnet distributor catalogs
                        </p>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div className="flex items-start gap-2.5">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors ${
                        dispatchStage > 2 ? 'bg-[#2e7d32] text-white' : dispatchStage === 2 ? 'bg-[#0a6ed1] text-white animate-pulse' : 'bg-[#e0e0e0] text-[#777777]'
                      }`}>
                        {dispatchStage > 2 ? <Check className="w-3 h-3" /> : 2}
                      </div>
                      <div>
                        <span className={`text-[11px] font-bold ${dispatchStage >= 2 ? 'text-[#222222]' : 'text-[#888888]'}`}>
                          Step 2: Original out of stock. Initiating Engineering Agent for datasheet analysis...
                        </span>
                        <p className="text-[10px] text-[#666666]">
                          Multimodal pinout matching, thermal rating verification, and drop-in search
                        </p>
                      </div>
                    </div>

                    {/* Step 3 */}
                    <div className="flex items-start gap-2.5">
                      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 transition-colors ${
                        dispatchStage === 3 ? 'bg-[#0a6ed1] text-white animate-pulse' : 'bg-[#e0e0e0] text-[#777777]'
                      }`}>
                        3
                      </div>
                      <div>
                        <span className={`text-[11px] font-bold ${dispatchStage === 3 ? 'text-[#222222]' : 'text-[#888888]'}`}>
                          Step 3: EDI Purchase Order Dispatch & SAP Writeback
                        </span>
                        <p className="text-[10px] text-[#666666]">
                          Generating automated Purchase Order and transmitting S/4HANA material master writeback
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          ))}

        {/* =======================================================================
            DYNAMIC SAP S/4HANA EDI WRITEBACK CONFIRMATION (RESOLVED ITEMS)
            ======================================================================= */}
        {criticalItems
          .filter((item) => item.isResolved && item.aiVerdict)
          .map((item) => {
            const v = item.aiVerdict;
            const channel =
              v.distributor_quote?.distributor ||
              (v.workflow_route === "OEM_CUSTOM_ESCALATION" ? "OEM Escalate" : "Distributor Direct");

            const confidenceDisplay =
              typeof v.confidence_score === "number"
                ? v.confidence_score <= 1
                  ? `${(v.confidence_score * 100).toFixed(1)}%`
                  : `${v.confidence_score}%`
                : `${v.confidence_score || 95}%`;

            const auditTrail = `[EDI ROUTE: ${v.workflow_route || "ALTERNATIVE_ENGINEERED"}] ${
              v.message ||
              (v.workflow_route === "OEM_CUSTOM_ESCALATION"
                ? `Escalated ${item.materialNumber} to OEM engineering team. Commercial market catalog exhausted; proprietary custom tooling required.`
                : v.workflow_route === "EXACT_ORIGINAL_PROCURED"
                ? `Exact original ${item.materialNumber} located with distributor stock. Automated PO dispatched via EDI gateway.`
                : `Drop-in replacement ${v.candidate_mpn} authorized for ${item.materialNumber}. S/4HANA material master BOM updated and PO confirmed.`)
            }`;

            return (
              <section key={"writeback-" + item.id} className="bg-white border border-[#cccccc] p-4 shadow-xs">
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-[#e5e5e5]">
                  <div className="flex items-center gap-2">
                    {v.workflow_route === "EXACT_ORIGINAL_UNAVAILABLE" ? (
                      <AlertOctagon className="w-5 h-5 text-[#d32f2f]" />
                    ) : v.aml_authorization && v.workflow_route !== "OEM_CUSTOM_ESCALATION" ? (
                      <CheckCircle2 className="w-5 h-5 text-[#2e7d32]" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-[#f57c00]" />
                    )}
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-[13px] font-bold text-[#222222]">
                          SAP S/4HANA EDI Writeback Confirmation - DropIn.ai Autonomous Pipeline
                        </h4>
                        {v.workflow_route && (
                          <span
                            className={`px-2 py-0.5 text-[9px] font-bold font-mono tracking-wider uppercase border ${
                              v.workflow_route === "OEM_CUSTOM_ESCALATION"
                                ? "text-orange-600 bg-orange-50 border-orange-200"
                                : v.workflow_route === "EXACT_ORIGINAL_UNAVAILABLE"
                                ? "text-red-700 bg-red-50 border-red-300"
                                : v.workflow_route === "EXACT_ORIGINAL_PROCURED"
                                ? "bg-[#e8f5e9] text-[#2e7d32] border-[#a5d6a7]"
                                : "bg-[#e3f2fd] text-[#0a6ed1] border-[#90caf9]"
                            }`}
                          >
                            {v.workflow_route === "OEM_CUSTOM_ESCALATION"
                              ? "OEM ESCALATION REQUIRED"
                              : v.workflow_route === "EXACT_ORIGINAL_UNAVAILABLE"
                              ? "EXACT MATCH UNAVAILABLE"
                              : v.workflow_route === "EXACT_ORIGINAL_PROCURED"
                              ? "Exact OEM Procured"
                              : "Alternative Engineered"}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-[#666666]">
                        Execution Status:{" "}
                        <span
                          className={`font-bold ${
                            v.workflow_route === "OEM_CUSTOM_ESCALATION"
                              ? "text-orange-600"
                              : v.workflow_route === "EXACT_ORIGINAL_UNAVAILABLE"
                              ? "text-[#c62828]"
                              : v.aml_authorization
                              ? "text-[#2e7d32]"
                              : "text-[#c62828]"
                          }`}
                        >
                          {v.procurement_status ||
                            (v.workflow_route === "OEM_CUSTOM_ESCALATION"
                              ? "OEM_ESCALATED"
                              : v.workflow_route === "EXACT_ORIGINAL_UNAVAILABLE"
                              ? "EXACT_ORIGINAL_UNAVAILABLE"
                              : "EDI_TRANSMITTED")}
                        </span>
                      </p>
                    </div>
                  </div>

                  {v.purchase_order_id && (
                    <div className="text-right">
                      <div className="text-[10px] text-[#777777] uppercase tracking-wider font-semibold">
                        Generated EDI Purchase Order
                      </div>
                      <div className="text-[13px] font-bold text-[#0a6ed1] font-mono">
                        {v.purchase_order_id}
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-[12px] bg-[#f9f9f9] p-3 border border-[#e0e0e0] mb-3">
                  <div>
                    <span className="text-[10px] uppercase text-[#777777] font-semibold block">Target Component</span>
                    <span className="font-bold text-[#333333]">{item.materialNumber}</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-[#777777] font-semibold block">
                      {v.workflow_route === "OEM_CUSTOM_ESCALATION"
                        ? "Escalation Status"
                        : "Procured / Drop-In Replacement"}
                    </span>
                    <span
                      className={`font-bold ${
                        v.workflow_route === "OEM_CUSTOM_ESCALATION"
                          ? "text-orange-600"
                          : v.workflow_route === "EXACT_ORIGINAL_UNAVAILABLE"
                          ? "text-red-600"
                          : "text-[#0a6ed1]"
                      }`}
                    >
                      {v.candidate_mpn}
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-[#777777] font-semibold block">AI Confidence Score</span>
                    <span className="font-bold text-[#2e7d32]">
                      {confidenceDisplay} (Gemini Multimodal)
                    </span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase text-[#777777] font-semibold block">Procurement Channel</span>
                    <span className="font-bold text-[#333333]">
                      {channel}
                    </span>
                  </div>
                </div>

                {v.search_reasoning && (
                  <div className="text-[11px] text-[#1b5e20] bg-[#e8f5e9] p-3 border border-[#c8e6c9] leading-relaxed mb-3">
                    <div className="font-bold text-[#1b5e20] flex items-center gap-1.5 mb-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#2e7d32]" />
                      <span>Google Search Grounding & Chain-of-Thought Reasoning:</span>
                    </div>
                    <p className="text-[#2e7d32] font-medium leading-relaxed">{v.search_reasoning}</p>
                  </div>
                )}

                {/* ACTIONABLE HIGHLY VISIBLE PROCUREMENT BUTTON */}
                {v.workflow_route === "EXACT_ORIGINAL_UNAVAILABLE" ? (
                  <div className="mb-3 p-3 bg-neutral-100 border border-neutral-300 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-bold text-[#c62828] uppercase tracking-wider">
                          Exact Original Stock Exhausted:
                        </span>
                        <span className="text-[11px] text-[#c62828] font-bold font-mono">
                          0 Units Available on Global Distributors
                        </span>
                      </div>
                      <p className="text-[10px] text-[#555555] font-mono mt-0.5">
                        Target MPN {item.materialNumber} is unavailable or obsolete on commercial distributor networks.
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled
                      className="px-5 py-2.5 bg-neutral-300 text-neutral-600 font-bold text-[12px] uppercase tracking-wider shadow-none inline-flex items-center gap-2 border border-neutral-400 cursor-not-allowed select-none"
                    >
                      <X className="w-4 h-4 shrink-0" />
                      <span>OUT OF STOCK ON DISTRIBUTOR NETWORKS</span>
                    </button>
                  </div>
                ) : v.action_buy_url && (
                  <div
                    className={`mb-3 p-3 ${
                      v.workflow_route === "OEM_CUSTOM_ESCALATION"
                        ? "bg-[#fff3e0] border-[#ffe0b2]"
                        : "bg-[#e8f0fe] border-[#d2e3fc]"
                    } border flex flex-wrap items-center justify-between gap-3`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        {v.workflow_route === "OEM_CUSTOM_ESCALATION" ? (
                          <span className="text-[11px] font-bold text-[#e65100] uppercase tracking-wider">
                            Proprietary Custom Component - Commercial Sourcing Unavailable
                          </span>
                        ) : (
                          <>
                            <span className="text-[11px] font-bold text-[#1967d2] uppercase tracking-wider">
                              Verified Distributor Inventory Channel:
                            </span>
                            <span className="text-[11px] text-[#137333] font-bold font-mono">
                              {v.distributor_quote?.stock_available !== undefined
                                ? `${v.distributor_quote.stock_available.toLocaleString()} Units In Stock`
                                : "Immediate Stock Available"}
                            </span>
                          </>
                        )}
                      </div>
                      <p className="text-[10px] text-[#5f6368] font-mono mt-0.5">
                        {v.workflow_route === "OEM_CUSTOM_ESCALATION"
                          ? `OEM Contact / Escalation Portal: ${v.action_buy_url}`
                          : `Catalog Direct URL: ${v.action_buy_url}`}
                      </p>
                    </div>

                    <a
                      href={v.action_buy_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`px-5 py-2.5 ${
                        v.workflow_route === "OEM_CUSTOM_ESCALATION"
                          ? "bg-[#c62828] hover:bg-[#b71c1c] active:bg-[#8e0000] border-[#b71c1c]"
                          : "bg-[#0a6ed1] hover:bg-[#0854a0] active:bg-[#064380] border-[#0854a0]"
                      } text-white font-bold text-[12px] uppercase tracking-wider transition-colors shadow-xs inline-flex items-center gap-2 border cursor-pointer`}
                    >
                      {v.workflow_route === "OEM_CUSTOM_ESCALATION" ? (
                        <>
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>ESCALATE TO OEM ENGINEERING</span>
                        </>
                      ) : (
                        <>
                          <ShoppingCart className="w-4 h-4 shrink-0" />
                          <span>Procure Component via {channel}</span>
                        </>
                      )}
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                    </a>
                  </div>
                )}

                <div className="text-[11px] text-[#555555] bg-white p-2.5 border border-[#e0e0e0] leading-relaxed">
                  <span className="font-bold text-[#222222]">System Audit Trail: </span>
                  {auditTrail}
                </div>

                {v.critical_differences && v.critical_differences.length > 0 && (
                  <div className="mt-3 text-[11px]">
                    <span className="font-bold text-[#222222]">Drop-In Engineering Constraints Verified:</span>
                    <ul className="list-disc pl-5 mt-1 space-y-0.5 text-[#555555]">
                      {v.critical_differences.map((diff: string, idx: number) => (
                        <li key={idx}>{diff}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            );
          })}

        {/* =======================================================================
            SAP DENSE DATA TABLE CONTAINER
            ======================================================================= */}
        <section className="bg-white border border-[#cccccc] shadow-xs">
          {/* Table Toolbar */}
          <div className="px-4 py-2 border-b border-[#cccccc] bg-[#f2f2f2] flex flex-wrap items-center justify-between gap-3 text-[12px]">
            <div className="flex items-center gap-2">
              <span className="font-bold text-[#333333] text-[12px]">BOM Line Items:</span>
              <div className="flex items-center gap-1 border border-[#cccccc] bg-white">
                <button
                  onClick={() => setSelectedFilter("ALL")}
                  className={`px-2 py-0.5 text-[11px] cursor-pointer ${
                    selectedFilter === "ALL" ? "bg-[#0a6ed1] text-white font-bold" : "text-[#555555] hover:bg-[#f2f2f2]"
                  }`}
                >
                  All ({items.length})
                </button>
                <button
                  onClick={() => setSelectedFilter("EXCEPTIONS")}
                  className={`px-2 py-0.5 text-[11px] cursor-pointer ${
                    selectedFilter === "EXCEPTIONS"
                      ? "bg-[#d32f2f] text-white font-bold"
                      : "text-[#555555] hover:bg-[#f2f2f2]"
                  }`}
                >
                  Below Safety ({breachedItems.length})
                </button>
                <button
                  onClick={() => setSelectedFilter("NORMAL")}
                  className={`px-2 py-0.5 text-[11px] cursor-pointer ${
                    selectedFilter === "NORMAL"
                      ? "bg-[#2e7d32] text-white font-bold"
                      : "text-[#555555] hover:bg-[#f2f2f2]"
                  }`}
                >
                  In Spec ({items.length - breachedItems.length})
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Quick Search */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="Filter materials..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-7 pr-2 py-0.5 text-[11px] border border-[#cccccc] bg-white w-48 focus:outline-none focus:border-[#0a6ed1]"
                />
                <Search className="w-3.5 h-3.5 text-[#888888] absolute left-2 top-1.5" />
              </div>

              <div className="h-4 w-[1px] bg-[#cccccc]" />

              <button
                className="flex items-center gap-1 text-[11px] text-[#555555] hover:text-[#000000] px-1 py-0.5 cursor-pointer"
                title="Export Grid to CSV / XLSX"
              >
                <Download className="w-3 h-3" />
                <span>Export</span>
              </button>
              <button
                className="flex items-center gap-1 text-[11px] text-[#555555] hover:text-[#000000] px-1 py-0.5 cursor-pointer"
                title="Print Form"
              >
                <Printer className="w-3 h-3" />
                <span>Print</span>
              </button>
            </div>
          </div>

          {/* DENSE DATA TABLE */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[11px] border-collapse" style={{ fontVariantNumeric: "tabular-nums" }}>
              <thead>
                <tr className="bg-[#e9e9e9] text-[#444444] border-b border-[#cccccc] uppercase font-bold text-[10px] tracking-wider select-none">
                  <th className="py-2.5 px-3 border-r border-[#cccccc]">Layer</th>
                  <th className="py-2.5 px-3 border-r border-[#cccccc]">Material Number</th>
                  <th className="py-2.5 px-3 border-r border-[#cccccc]">Description</th>
                  <th className="py-2.5 px-3 border-r border-[#cccccc]">Vendor</th>
                  <th className="py-2.5 px-3 border-r border-[#cccccc]">Storage Loc</th>
                  <th className="py-2.5 px-3 border-r border-[#cccccc] text-right">
                    Unrestricted Stock (Editable)
                  </th>
                  <th className="py-2.5 px-3 border-r border-[#cccccc] text-right">Safety Stock</th>
                  <th className="py-2.5 px-3 border-r border-[#cccccc]">Lead Time</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3 text-center">Simulate</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item, idx) => {
                  const isZero = item.stock === 0;
                  const isBreached = item.stock <= item.safetyStock;

                  return (
                    <tr
                      key={item.id}
                      className={`border-b border-[#e5e5e5] transition-colors ${
                        isZero
                          ? "bg-[#ffebee] hover:bg-[#ffcdd2]/60 font-medium"
                          : isBreached
                          ? "bg-[#fff8e1] hover:bg-[#ffe082]/50 font-medium"
                          : idx % 2 === 1
                          ? "bg-[#fafafa] hover:bg-[#f0f0f0]"
                          : "bg-white hover:bg-[#f0f0f0]"
                      }`}
                    >
                      {/* Layer */}
                      <td className="py-2 px-3 border-r border-[#e0e0e0] font-mono text-[#666666] text-center">
                        {String(item.layerIndex).padStart(2, "0")}
                      </td>

                      {/* Material Number */}
                      <td className="py-2 px-3 border-r border-[#e0e0e0] font-mono text-[#111111] font-semibold whitespace-nowrap">
                        {item.mpn}
                      </td>

                      {/* Description */}
                      <td className="py-2 px-3 border-r border-[#e0e0e0] text-[#222222]">
                        <span className="font-semibold">{item.name}</span>
                        <div className="text-[10px] text-[#666666] line-clamp-1">{item.description}</div>
                      </td>

                      {/* Vendor */}
                      <td className="py-2 px-3 border-r border-[#e0e0e0] text-[#555555] whitespace-nowrap">
                        {item.vendor}
                      </td>

                      {/* Storage Location */}
                      <td className="py-2 px-3 border-r border-[#e0e0e0] font-mono text-[#555555] whitespace-nowrap">
                        {item.storageLocation}
                      </td>

                      {/* Unrestricted Stock (Interactive Editable Input) */}
                      <td className="py-2 px-3 border-r border-[#e0e0e0] text-right font-mono whitespace-nowrap">
                        <div className="inline-flex items-center gap-1 justify-end">
                          <input
                            type="number"
                            min="0"
                            step="500"
                            value={item.stock}
                            onChange={(e) => updateStock(item.id, Number(e.target.value))}
                            className={`w-24 px-1.5 py-0.5 text-right font-mono font-bold text-[12px] border ${
                              isZero
                                ? "bg-white border-[#d32f2f] text-[#c62828]"
                                : isBreached
                                ? "bg-white border-[#f57c00] text-[#e65100]"
                                : "bg-white border-[#cccccc] text-[#222222]"
                            } focus:outline-none focus:border-[#0a6ed1]`}
                          />
                          <span className="text-[10px] text-[#777777]">EA</span>
                        </div>
                      </td>

                      {/* Safety Stock */}
                      <td className="py-2 px-3 border-r border-[#e0e0e0] text-right font-mono text-[#666666] whitespace-nowrap">
                        {item.safetyStock.toLocaleString()} EA
                      </td>

                      {/* Lead Time */}
                      <td
                        className={`py-2 px-3 border-r border-[#e0e0e0] whitespace-nowrap ${
                          isBreached ? "text-[#c62828] font-bold" : "text-[#444444]"
                        }`}
                      >
                        {item.leadTime}
                      </td>

                      {/* Status */}
                      <td className="py-2 px-3 text-center whitespace-nowrap">
                        {item.isResolved && item.aiVerdict ? (
                          item.aiVerdict.workflow_route === "OEM_CUSTOM_ESCALATION" ? (
                            <span className="inline-block px-2 py-0.5 bg-orange-100 text-orange-800 border border-orange-300 text-[9px] font-bold uppercase tracking-wider rounded-none">
                              OEM ESCALATED
                            </span>
                          ) : item.aiVerdict.workflow_route === "EXACT_ORIGINAL_UNAVAILABLE" ? (
                            <span className="inline-block px-2 py-0.5 bg-red-100 text-red-800 border border-red-300 text-[9px] font-bold uppercase tracking-wider rounded-none">
                              EXACT MATCH UNAVAILABLE
                            </span>
                          ) : (
                            <span className="inline-block px-2 py-0.5 bg-[#e8f5e9] text-[#2e7d32] border border-[#a5d6a7] text-[9px] font-bold uppercase tracking-wider rounded-none shadow-2xs">
                              RESOLVED • EDI WRITTEN
                            </span>
                          )
                        ) : isZero ? (
                          <span className="inline-block px-2 py-0.5 bg-[#d32f2f] text-white text-[9px] font-bold uppercase tracking-wider rounded-none shadow-2xs">
                            LINE DOWN EXCEPTION
                          </span>
                        ) : isBreached ? (
                          <span className="inline-block px-2 py-0.5 bg-[#f57c00] text-white text-[9px] font-bold uppercase tracking-wider rounded-none">
                            BELOW SAFETY STOCK
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 bg-[#e8f5e9] text-[#2e7d32] border border-[#c8e6c9] text-[9px] font-bold uppercase tracking-wider rounded-none">
                            IN SPEC
                          </span>
                        )}
                      </td>

                      {/* Quick Simulate Buttons */}
                      <td className="py-1 px-2 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => updateStock(item.id, Math.floor(item.safetyStock * 0.5))}
                            className="px-1.5 py-0.5 bg-white border border-[#cccccc] hover:bg-[#fff3e0] text-[10px] text-[#c62828] font-semibold cursor-pointer"
                            title="Drop to 50% safety stock"
                          >
                            -50%
                          </button>
                          <button
                            onClick={() => updateStock(item.id, 0)}
                            className="px-1.5 py-0.5 bg-white border border-[#cccccc] hover:bg-[#ffebee] text-[10px] text-[#b71c1c] font-bold cursor-pointer"
                            title="Set to 0 (Line Down)"
                          >
                            Zero
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Table Footer Status Information */}
          <div className="px-4 py-2 bg-[#f9f9f9] border-t border-[#cccccc] flex items-center justify-between text-[10px] text-[#777777]">
            <div className="flex items-center gap-3">
              <span>Showing {filteredItems.length} of {items.length} BOM components</span>
              <span>•</span>
              <span>
                Critical Exceptions: <strong className="text-[#c62828]">{breachedItems.length}</strong>
              </span>
              <span>•</span>
              <span>Storage System: High-Bay Automated Warehouse (AS/RS Plant HYD-01)</span>
            </div>
            <div>
              <span>SAP GUI Version: 8.00 Patchlevel 4 | Kernel 7.93</span>
            </div>
          </div>
        </section>

        {/* =======================================================================
            FOOTER CALLOUT TO 3D DIGITAL TWIN
            ======================================================================= */}
        <div className="bg-white border border-[#cccccc] p-3 flex items-center justify-between text-[11px] text-[#555555]">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-[#0a6ed1]" />
            <span>
              Connected to <strong>DropIn.ai Digital Twin</strong>. Inventory modifications made in
              this table instantly render in the 3D WebGL assembly via reactive Zustand state synchronization.
            </span>
          </div>

          <Link
            href="/"
            className="text-[#0a6ed1] font-bold hover:underline flex items-center gap-1"
          >
            <span>Switch to DropIn.ai 3D Twin</span>
            <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </main>
    </div>
  );
}
