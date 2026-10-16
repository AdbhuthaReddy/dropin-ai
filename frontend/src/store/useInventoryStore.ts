import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface InventoryItem {
  id: string;
  mpn: string;
  materialNumber: string;
  name: string;
  description: string;
  vendor: string;
  storageLocation: string;
  stock: number;
  safetyStock: number;
  leadTime: string;
  normalMaterial: string;
  meshType: string;
  layerIndex: number;
  isDropInReplacement?: boolean;
  altMpn?: string;
  isResolved?: boolean;
  aiVerdict?: any;
}

export interface InventoryStoreState {
  items: InventoryItem[];
  selectedPartId: string | null;
  lastBreachedMpn: string | null;
  updateStock: (id: string, newStock: number) => void;
  setSelectedPartId: (id: string | null) => void;
  setDropInResolution: (mpn: string, altMpn: string, stockAdded: number, leadTimeDays: number, vendor: string) => void;
  markResolved: (materialNumber: string, verdict: any) => void;
  resetAll: () => void;
  simulateShortage: (id: string) => void;
}

export const INITIAL_BOM: InventoryItem[] = [
  {
    id: "outer-shell",
    mpn: "FXN-GRVCC-SHL-PNY",
    materialNumber: "FXN-GRVCC-SHL-PNY",
    name: "Outer Polycarbonate Shell",
    description: "Foxconn Custom Polycarbonate Enclosure (Peony)",
    vendor: "Foxconn Precision Moldings",
    storageLocation: "SL-01-A",
    stock: 15000,
    safetyStock: 5000,
    leadTime: "6 Weeks",
    normalMaterial: "Peony Pink Polycarbonate",
    meshType: "dome",
    layerIndex: 1
  },
  {
    id: "acoustic-mesh",
    mpn: "GAW325",
    materialNumber: "GAW325",
    name: "Wind-blocking Acoustic Mesh",
    description: "W. L. Gore ePTFE Acoustic Vent (IPX8)",
    vendor: "W. L. Gore & Associates",
    storageLocation: "SL-01-B",
    stock: 12000,
    safetyStock: 4000,
    leadTime: "8 Weeks",
    normalMaterial: "ePTFE Membrane",
    meshType: "ring",
    layerIndex: 2
  },
  {
    id: "touch-sensor",
    mpn: "NMF-FPC-CAP-02",
    materialNumber: "NMF-FPC-CAP-02",
    name: "Capacitive Touch Sensor Film",
    description: "Nippon Mektron Flexible Printed Circuit Touch Sensor",
    vendor: "Nippon Mektron Ltd.",
    storageLocation: "SL-01-C",
    stock: 8000,
    safetyStock: 2000,
    leadTime: "4 Weeks",
    normalMaterial: "Copper / Polyimide Flex",
    meshType: "disc",
    layerIndex: 3
  },
  {
    id: "tensor-a1",
    mpn: "GGL-TENS-A1-REV2",
    materialNumber: "GGL-TENS-A1-REV2",
    name: "Tensor A1 SoC Audio DSP",
    description: "Google Tensor A1 Audio SoC (TSMC N4)",
    vendor: "Google Custom Silicon / TSMC",
    storageLocation: "SL-02-A",
    stock: 14500,
    safetyStock: 5000,
    leadTime: "12 Weeks",
    normalMaterial: "Dark Green High-Density PCB",
    meshType: "pcb",
    layerIndex: 4
  },
  {
    id: "pmic",
    mpn: "MAX77650EWV+T",
    materialNumber: "MAX77650EWV+T",
    name: "Analog Devices SIMO PMIC",
    description: "Analog Devices SIMO PMIC (WLP-30)",
    vendor: "Analog Devices / Maxim Integrated",
    storageLocation: "SL-02-B",
    stock: 8000,
    safetyStock: 2500,
    leadTime: "52 Weeks",
    normalMaterial: "Silicon Chip Package",
    meshType: "chip",
    layerIndex: 5
  },
  {
    id: "mic-array",
    mpn: "SPH0641LU4H-1",
    materialNumber: "SPH0641LU4H-1",
    name: "3x MEMS Microphone Array",
    description: "Knowles Digital Bottom-Port MEMS Microphone",
    vendor: "Knowles Acoustics",
    storageLocation: "SL-02-C",
    stock: 22000,
    safetyStock: 6000,
    leadTime: "6 Weeks",
    normalMaterial: "Gold MEMS Housing",
    meshType: "micCluster",
    layerIndex: 6
  },
  {
    id: "imu-sensor",
    mpn: "BMI323",
    materialNumber: "BMI323",
    name: "6-Axis IMU Sensor",
    description: "Bosch Sensortec 6-Axis IMU (LGA-14)",
    vendor: "Bosch Sensortec",
    storageLocation: "SL-02-D",
    stock: 21000,
    safetyStock: 7000,
    leadTime: "6 Weeks",
    normalMaterial: "Black Molded Epoxy Resin",
    meshType: "sensorBox",
    layerIndex: 7
  },
  {
    id: "battery",
    mpn: "CP1154-A3",
    materialNumber: "CP1154-A3",
    name: "VARTA CP1154 Li-ion Battery",
    description: "VARTA Microbattery Li-Ion Coin Cell (85mAh)",
    vendor: "VARTA Microbattery GmbH",
    storageLocation: "SL-03-A",
    stock: 9000,
    safetyStock: 3000,
    leadTime: "8 Weeks",
    normalMaterial: "Brushed Stainless Steel",
    meshType: "cylinderCell",
    layerIndex: 8
  },
  {
    id: "transducer",
    mpn: "GTR-11MM-D",
    materialNumber: "GTR-11MM-D",
    name: "11mm Dynamic Transducer",
    description: "Goertek Custom 11mm Dynamic Driver",
    vendor: "Goertek Acoustics",
    storageLocation: "SL-03-B",
    stock: 5400,
    safetyStock: 2000,
    leadTime: "16 Weeks",
    normalMaterial: "Dark Titanium Chamber",
    meshType: "driverCone",
    layerIndex: 9
  },
  {
    id: "eartip",
    mpn: "CP1025-M",
    materialNumber: "CP1025-M",
    name: "Liquid Silicone Eartip",
    description: "SpinFit Medical-Grade Silicone Eartip (Medium)",
    vendor: "SpinFit / HiFineTech",
    storageLocation: "SL-03-C",
    stock: 30000,
    safetyStock: 10000,
    leadTime: "3 Weeks",
    normalMaterial: "Translucent White Silicone",
    meshType: "siliconeTip",
    layerIndex: 10
  }
];

export const useInventoryStore = create<InventoryStoreState>()(
  persist(
    (set, get) => ({
      items: INITIAL_BOM,
      selectedPartId: null,
      lastBreachedMpn: null,

      updateStock: (id: string, newStock: number) => {
        const sanitized = Math.max(0, Math.floor(newStock));
        set((state) => {
          let breachedMpn = state.lastBreachedMpn;
          const updated = state.items.map((item) => {
            if (item.id === id || item.mpn === id) {
              const newItem = { ...item, stock: sanitized };
              if (sanitized <= item.safetyStock) {
                breachedMpn = item.mpn;
              }
              return newItem;
            }
            return item;
          });
          return { items: updated, lastBreachedMpn: breachedMpn };
        });
      },

      setSelectedPartId: (id: string | null) => {
        set({ selectedPartId: id });
      },

      setDropInResolution: (
        mpn: string,
        altMpn: string,
        stockAdded: number,
        leadTimeDays: number,
        vendor: string
      ) => {
        set((state) => ({
          items: state.items.map((item) => {
            if (item.mpn.toUpperCase() === mpn.toUpperCase()) {
              return {
                ...item,
                stock: item.stock + stockAdded,
                leadTime: `${leadTimeDays} Days (Expedited Alternative)`,
                vendor: vendor,
                isDropInReplacement: true,
                altMpn: altMpn,
                description: `${item.description} [AUTHORIZED DROP-IN: ${altMpn}]`
              };
            }
            return item;
          }),
          lastBreachedMpn: null
        }));
      },

      markResolved: (materialNumber: string, verdict: any) => {
        set((state) => ({
          items: state.items.map((item) => {
            const matches =
              item.materialNumber.toLowerCase() === materialNumber.toLowerCase() ||
              item.mpn.toLowerCase() === materialNumber.toLowerCase() ||
              item.id.toLowerCase() === materialNumber.toLowerCase();
            if (matches) {
              return {
                ...item,
                isResolved: true,
                aiVerdict: verdict
              };
            }
            return item;
          }),
          lastBreachedMpn: state.lastBreachedMpn?.toLowerCase() === materialNumber.toLowerCase() ? null : state.lastBreachedMpn
        }));
      },

      resetAll: () => {
        set({
          items: INITIAL_BOM.map((item) => ({
            ...item,
            isResolved: false,
            aiVerdict: undefined,
            isDropInReplacement: false,
            altMpn: undefined
          })),
          selectedPartId: null,
          lastBreachedMpn: null
        });
      },

      simulateShortage: (id: string) => {
        const target = get().items.find((i) => i.id === id || i.mpn === id || i.materialNumber === id);
        if (target) {
          const droppedStock = Math.max(0, Math.floor(target.safetyStock * 0.4));
          set((state) => ({
            items: state.items.map((item) =>
              item.id === target.id
                ? {
                    ...item,
                    stock: droppedStock,
                    isResolved: false,
                    aiVerdict: undefined,
                    isDropInReplacement: false,
                    altMpn: undefined
                  }
                : item
            ),
            selectedPartId: target.id,
            lastBreachedMpn: target.mpn
          }));
        }
      }
    }),
    {
      name: "dropin-inventory-store",
      storage: createJSONStorage(() => (typeof window !== "undefined" ? window.localStorage : {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
      }))
    }
  )
);

