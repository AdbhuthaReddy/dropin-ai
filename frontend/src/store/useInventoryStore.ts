import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface InventoryItem {
  id: string;
  mpn: string;
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
}

export interface InventoryStoreState {
  items: InventoryItem[];
  selectedPartId: string | null;
  lastBreachedMpn: string | null;
  updateStock: (id: string, newStock: number) => void;
  setSelectedPartId: (id: string | null) => void;
  setDropInResolution: (mpn: string, altMpn: string, stockAdded: number, leadTimeDays: number, vendor: string) => void;
  resetAll: () => void;
  simulateShortage: (id: string) => void;
}

export const INITIAL_BOM: InventoryItem[] = [
  {
    id: "outer-shell",
    mpn: "MAT-SHL-PEONY",
    name: "Outer Polycarbonate Shell",
    description: "Matte Peony Pink half-dome shell with G logo capacitive touch window",
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
    mpn: "MAT-MSH-WIND",
    name: "Wind-blocking Acoustic Mesh",
    description: "Micro-perforated hydrophobic acoustic mesh barrier (IPX4 rating)",
    vendor: "Saati Micro Acoustic Tech",
    storageLocation: "SL-01-B",
    stock: 12000,
    safetyStock: 4000,
    leadTime: "8 Weeks",
    normalMaterial: "Stainless Micromesh",
    meshType: "ring",
    layerIndex: 2
  },
  {
    id: "touch-sensor",
    mpn: "MAT-TCH-CAP",
    name: "Capacitive Touch Sensor Film",
    description: "Multi-gesture flexible circuit with swipe & tap detection",
    vendor: "Nippon Mektron Flex",
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
    mpn: "MAT-TEN-A1-09",
    name: "Tensor A1 SoC Audio DSP",
    description: "Google Tensor A1 low-latency dual-core audio processor with ANC DSP",
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
    mpn: "NXP-BQ25611",
    name: "NXP BQ25611 PMIC",
    description: "High-efficiency single-cell I2C battery power management IC (WLCSP-30)",
    vendor: "NXP Semiconductors",
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
    mpn: "MAT-MIC-MEMS3",
    name: "3x MEMS Microphone Array",
    description: "Triple spatial beamforming MEMS mics with SNR > 68dB for active ANC",
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
    mpn: "MAT-BOSCH-BMI323",
    name: "6-Axis IMU Sensor",
    description: "Ultra-low power 6-axis accelerometer & gyroscope for spatial audio head-tracking",
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
    mpn: "MAT-VARTA-CP1154",
    name: "VARTA CP1154 Li-ion Battery",
    description: "High energy-density 3.7V CoinPower rechargeable Li-Ion cell (85mAh)",
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
    mpn: "MAT-GOER-11MM",
    name: "11mm Dynamic Transducer",
    description: "Custom 11mm dynamic driver with high-flux neodymium magnet chamber",
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
    mpn: "MAT-TIP-SILICONE",
    name: "Liquid Silicone Eartip",
    description: "Medical-grade liquid silicone eartip with integrated acoustic wax filter",
    vendor: "Shin-Etsu Chemical Co.",
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

      resetAll: () => {
        set({
          items: INITIAL_BOM,
          selectedPartId: null,
          lastBreachedMpn: null
        });
      },

      simulateShortage: (id: string) => {
        const target = get().items.find((i) => i.id === id || i.mpn === id);
        if (target) {
          const droppedStock = Math.max(0, Math.floor(target.safetyStock * 0.4));
          get().updateStock(target.id, droppedStock);
          set({ selectedPartId: target.id, lastBreachedMpn: target.mpn });
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

