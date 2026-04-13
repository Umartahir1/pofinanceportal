import { PurchaseOrder, InvestorProfile, Reservation, BankTransaction, PaymentOption } from './types';

export const paymentOptions: PaymentOption[] = [
  { label: '90 Days with 10% interest', days: 90, interest: 10 },
];

export const mockPOs: PurchaseOrder[] = [
  { 
    id: '1', 
    poNumber: 'PO-2024-001', 
    vendor: 'Global Tech Solutions', 
    amount: 45000, 
    totalQuantity: 10,
    status: 'To be Shipped', 
    description: 'Server Hardware for Q2 Expansion', 
    date: '2024-03-10',
    location: 'Main Warehouse',
    owner: 'Admin',
    isPublished: true,
    items: [
      { id: 'i1', inventoryId: 'SRV-001', description: 'Dell PowerEdge R740', uom: 'EA', quantity: 5, unitCost: 8000, extCost: 40000 },
      { id: 'i2', inventoryId: 'ACC-002', description: 'Rack Mount Kit', uom: 'EA', quantity: 5, unitCost: 1000, extCost: 5000 },
    ],
    orderQty: 10,
    openQty: 10
  },
  { 
    id: '2', 
    poNumber: 'PO-2024-002', 
    vendor: 'Lumina Manufacturing', 
    amount: 120000, 
    totalQuantity: 40,
    status: 'To be Shipped', 
    description: 'Raw Materials - Aluminum Grade A', 
    date: '2024-03-12',
    location: 'Factory A',
    owner: 'Admin',
    isPublished: true,
    items: [
      { id: 'i3', inventoryId: 'ALU-G-A', description: 'Aluminum Ingot Grade A', uom: 'TON', quantity: 40, unitCost: 3000, extCost: 120000 },
    ],
    orderQty: 40,
    openQty: 40
  },
  { 
    id: '3', 
    poNumber: 'PO-2024-003', 
    vendor: 'Swift Logistics', 
    amount: 15000, 
    totalQuantity: 1,
    status: 'Shipped', 
    description: 'Freight Services - International', 
    date: '2024-03-14',
    location: 'Port of Singapore',
    owner: 'Admin',
    isPublished: false,
    items: [
      { id: 'i4', inventoryId: 'FRT-INT', description: 'International Shipping Container', uom: 'CONT', quantity: 1, unitCost: 15000, extCost: 15000 },
    ],
    orderQty: 1,
    openQty: 0
  },
  { 
    id: '4', 
    poNumber: 'PO-2024-004', 
    vendor: 'Apex Components', 
    amount: 85000, 
    totalQuantity: 10000,
    status: 'Landed', 
    description: 'Electronic Components Batch 4', 
    date: '2024-03-15',
    location: 'Customs Bonded WH',
    owner: 'Admin',
    isPublished: true,
    items: [
      { id: 'i5', inventoryId: 'CMP-042', description: 'Microcontroller Unit X1', uom: 'EA', quantity: 10000, unitCost: 8.5, extCost: 85000 },
    ],
    orderQty: 10000,
    openQty: 0
  },
  { 
    id: '5', 
    poNumber: 'PO-2024-005', 
    vendor: 'Eco Packaging Co', 
    amount: 22000, 
    totalQuantity: 5000,
    status: 'To be Shipped', 
    description: 'Sustainable Packaging Supplies', 
    date: '2024-03-16',
    location: 'Regional Hub',
    owner: 'Admin',
    isPublished: true,
    items: [
      { id: 'i6', inventoryId: 'PKG-ECO', description: 'Recycled Cardboard Boxes', uom: 'UNIT', quantity: 5000, unitCost: 4.4, extCost: 22000 },
    ],
    orderQty: 5000,
    openQty: 5000
  },
];

export const mockInvestors: InvestorProfile[] = [
  { id: 'inv-1', name: 'Umar Tahir', email: 'umar.tahir@svjbrands.com', totalInvested: 250000, activeReservations: 2 },
  { id: 'inv-2', name: 'Sarah Chen', email: 'sarah.c@invest.com', totalInvested: 1200000, activeReservations: 5 },
];

export const mockReservations: Reservation[] = [
  { 
    id: 'res-1', 
    poId: '1', 
    investorId: 'inv-1', 
    amount: 45000, 
    paymentOption: paymentOptions[0], 
    status: 'Pending', 
    timestamp: '2024-03-17T10:00:00Z' 
  },
  { 
    id: 'res-2', 
    poId: '2', 
    investorId: 'inv-2', 
    amount: 120000, 
    paymentOption: paymentOptions[0], 
    status: 'Accepted', 
    timestamp: '2024-03-16T14:30:00Z' 
  },
];

export const mockTransactions: BankTransaction[] = [
  { id: 'tx-1', date: '2024-03-15', description: 'Wire Transfer - PO-2024-002 Funding', amount: 120000, type: 'Debit', linkedPoId: '2' },
  { id: 'tx-2', date: '2024-03-14', description: 'Interest Payment - PO-2023-098', amount: 4500, type: 'Credit' },
  { id: 'tx-3', date: '2024-03-13', description: 'Principal Repayment - PO-2023-098', amount: 50000, type: 'Credit' },
];
