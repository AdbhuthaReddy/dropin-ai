"use client";

import Link from "next/link";
import { useInventoryStore } from "@/store/useInventoryStore";
import ResearchCard from "./ResearchCard";

export default function AIPanel({ isOpen }: { isOpen: boolean }) {
  const { items, selectedPartId, setSelectedPartId } = useInventoryStore();
  const activeItem = items.find(item => item.id === selectedPartId)
    || items.find(item => item.stock < item.safetyStock)
    || items.find(item => item.id === "pmic")
    || items[0];
  if (!isOpen || !activeItem) return null;
  return (
    <aside aria-label="Component research console"
      className="absolute right-0 top-0 z-50 flex h-full w-full max-w-[480px] flex-col gap-4 overflow-y-auto border-l bg-white p-4 shadow-xl sm:p-6">
      <h2 className="text-lg font-bold">Component research console</h2>
      <label className="space-y-1 text-sm">
        <span className="block font-semibold">Research component</span>
        <select className="w-full rounded border p-2" value={activeItem.id} onChange={event => setSelectedPartId(event.target.value)}>
          {items.map(item => <option key={item.id} value={item.id}>{item.mpn} - {item.name}</option>)}
        </select>
      </label>
      <ResearchCard item={activeItem} />
      <Link className="text-sm text-blue-800 underline" href="/datasheets">Compare actual PDF datasheets</Link>
    </aside>
  );
}
