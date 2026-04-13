import { collection, doc, getDoc, setDoc, updateDoc, query, where, getDocs, limit, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { AutomationInput, AutomationOutput, Vendor, PurchaseOrder, POLine } from '../types';

// Add missing properties to PurchaseOrder for this service
interface ExtendedPurchaseOrder extends PurchaseOrder {
  financing_id?: string;
  processed?: boolean;
  vendor_id?: string;
  markup_percent?: number;
  lines?: POLine[];
  updatedAt?: any;
}

export function normalizeEmail(v: string): string {
  return v.trim().toLowerCase();
}

export function normalizeName(v: string): string {
  return v.trim().replace(/\s+/g, " ");
}

export async function processFinancing(input: AutomationInput): Promise<AutomationOutput> {
  const { po_number, markup_percent, financier, financing_id } = input;
  const normalizedEmail = normalizeEmail(financier.email);
  const normalizedName = normalizeName(financier.legal_name);

  try {
    // 1. Idempotency check
    if (financing_id) {
      const poRef = doc(db, 'purchase_orders', po_number);
      const poSnap = await getDoc(poRef);
      if (poSnap.exists()) {
        const poData = poSnap.data() as ExtendedPurchaseOrder;
        if (poData.financing_id === financing_id && poData.processed) {
          return {
            status: 'success',
            po_number,
            vendor_id: poData.vendor_id,
            markup_applied: poData.markup_percent,
            lines_updated: poData.lines?.length || 0
          };
        }
      }
    }

    // 2. Vendor Lookup
    let vendorId: string | null = null;
    const vendorsRef = collection(db, 'vendors');
    const q = query(
      vendorsRef,
      where('legal_name', '==', normalizedName),
      where('email', '==', normalizedEmail),
      limit(2)
    );

    const querySnapshot = await getDocs(q);
    if (querySnapshot.size > 1) {
      return {
        status: 'error',
        step: 'vendor_lookup',
        message: 'Multiple vendors matched exact criteria'
      };
    }

    if (querySnapshot.size === 1) {
      vendorId = querySnapshot.docs[0].id;
    } else {
      // 3. Create Vendor if not found
      const newVendorId = `V${Math.floor(10000 + Math.random() * 90000)}`;
      const newVendor: Vendor = {
        vendor_id: newVendorId,
        legal_name: normalizedName,
        email: normalizedEmail,
        createdAt: serverTimestamp()
      };
      await setDoc(doc(db, 'vendors', newVendorId), newVendor);
      vendorId = newVendorId;
    }

    // 4. Get PO Details
    const poRef = doc(db, 'purchase_orders', po_number);
    const poSnap = await getDoc(poRef);
    if (!poSnap.exists()) {
      return {
        status: 'error',
        step: 'po_fetch',
        message: 'PO not found'
      };
    }

    const poData = poSnap.data() as ExtendedPurchaseOrder;

    // 5. Reprice Logic
    const updatedLines: POLine[] = (poData.lines || []).map(line => ({
      ...line,
      unit_cost: line.unit_cost * (1 + markup_percent)
    }));

    // 6. Update PO
    const updateData: Partial<ExtendedPurchaseOrder> = {
      vendor_id: vendorId,
      lines: updatedLines,
      markup_percent: markup_percent,
      status: 'Shipped' as any, // Use existing status
      processed: true,
      financing_id: financing_id,
      updatedAt: serverTimestamp()
    };

    await updateDoc(poRef, updateData);

    return {
      status: 'success',
      po_number,
      vendor_id: vendorId,
      markup_applied: markup_percent,
      lines_updated: updatedLines.length
    };

  } catch (error) {
    console.error('Automation error:', error);
    return {
      status: 'error',
      step: 'automation_process',
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}
