export type POStatus = 'To be Shipped' | 'Shipped' | 'Landed' | 'Completed' | 'Funded';

export interface POItem {
  id: string;
  inventoryId: string;
  description: string;
  uom: string;
  quantity: number;
  unitCost: number;
  extCost: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  originalPoId?: string;
  originalPoNumber?: string;
  vendor: string;
  vendorName?: string;
  vendorRef?: string;
  vendorDetails?: {
    email?: string;
    phone?: string;
    address?: string;
    legalName?: string;
  };
  location: string;
  owner: string;
  amount: number;
  totalQuantity: number;
  status: POStatus;
  description: string;
  date: string;
  promisedOn?: string;
  orderQty?: number;
  openQty?: number;
  items: POItem[];
  isPublished: boolean; // Admin choice to show on Lender Portal
  visibility?: 'Published' | 'Hidden' | 'Funded' | 'Funded(Original)';
  reservedBy?: string; // Investor ID
  reservationStatus?: 'Pending' | 'Accepted' | 'Rejected' | 'Completed';
  reissuedPoId?: string; // ID of the new PO created after funding
}

export interface InvestorProfile {
  id: string;
  name: string; // This will be the Vendor Name (Company)
  contactName?: string; // This will be the Person Name
  email: string;
  address?: string; // Physical address for legal agreements
  vendorId?: string; // Acumatica Vendor ID
  totalInvested: number;
  activeReservations: number;
}

export interface PaymentOption {
  label: string;
  days: number;
  interest: number;
}

export interface Reservation {
  id: string;
  poId: string;
  originalPoId?: string;
  investorId: string;
  amount: number;
  paymentOption: PaymentOption;
  status: 'Pending' | 'Accepted' | 'Rejected';
  timestamp: string;
  paymentStatus?: 'Pending' | 'Paid';
}

export interface Contract {
  id: string;
  reservationId: string;
  poId: string;
  originalPoId?: string;
  investorId: string;
  generatedDate: string;
  status: 'Draft' | 'Sent' | 'Executed';
  content: string;
  unsignedDocumentUrl?: string;
  signedDocumentUrl?: string;
  docusignEnvelopeId?: string;
  signedAt?: string;
}

export interface BankTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: 'Credit' | 'Debit';
  linkedPoId?: string;
}

export interface Vendor {
  id?: string;
  vendorId?: string;
  vendorName?: string;
  lastSynced?: string;
  // For automation service compatibility
  legal_name?: string;
  email?: string;
  createdAt?: any;
  vendor_id?: string;
}

export interface AutomationInput {
  po_number: string;
  markup_percent: number;
  financier: {
    email: string;
    legal_name: string;
  };
  financing_id?: string;
}

export interface AutomationOutput {
  status: 'success' | 'error';
  po_number?: string;
  vendor_id?: string;
  markup_applied?: number;
  lines_updated?: number;
  step?: string;
  message?: string;
}

export interface POLine {
  id: string;
  inventory_id: string;
  description: string;
  uom: string;
  quantity: number;
  unit_cost: number;
  extended_cost: number;
}
