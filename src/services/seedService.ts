import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { PurchaseOrder } from '../types';

export async function seedSamplePO() {
  const po_number = 'PO12345';
  const poRef = doc(db, 'purchase_orders', po_number);
  
  const samplePO: any = {
    poNumber: po_number,
    vendor: 'VORIGINAL',
    status: 'To be Shipped',
    items: [
      {
        id: 'item-1',
        inventoryId: 'ITEM1',
        unitCost: 100,
        quantity: 10,
        description: 'Sample Item',
        uom: 'EA',
        extCost: 1000
      }
    ],
    isPublished: true,
    date: new Date().toISOString().split('T')[0],
    amount: 1000,
    totalQuantity: 10,
    description: 'Sample PO',
    location: 'Main Warehouse',
    owner: 'System',
    updatedAt: serverTimestamp()
  };

  try {
    await setDoc(poRef, samplePO);
    console.log('Sample PO seeded successfully');
    return true;
  } catch (error) {
    console.error('Error seeding sample PO:', error);
    return false;
  }
}
