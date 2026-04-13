/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { 
  Home,
  Users, 
  FileText, 
  Gavel, 
  TrendingUp, 
  ArrowRightLeft, 
  ShieldCheck,
  Package,
  ChevronRight,
  PlusCircle,
  Banknote,
  CheckCircle2,
  Clock,
  LogOut,
  Mail,
  ArrowRight,
  ShieldAlert,
  Search,
  Filter,
  ChevronDown,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  LayoutDashboard,
  MapPin,
  X,
  CreditCard,
  Download,
  Upload,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  onSnapshot, 
  query, 
  where, 
  updateDoc,
  serverTimestamp,
  increment,
  deleteField,
  deleteDoc
} from 'firebase/firestore';
import { auth, googleProvider, db } from './firebase';
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  GoogleAuthProvider
} from 'firebase/auth';
import { PurchaseOrder, Reservation, Contract, BankTransaction, InvestorProfile, PaymentOption, POItem, POStatus } from './types';
import { mockPOs, mockReservations, mockTransactions, mockInvestors, paymentOptions } from './mockData';
import { jsPDF } from 'jspdf';

type UserRole = 'lender' | 'admin' | null;
type AdminSubTab = 'inventory' | 'reservations' | 'legal' | 'finance';

export default function App() {
  const [user, setUser] = useState<{ email: string; role: UserRole } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginMode, setLoginMode] = useState<'login' | 'signup'>('login');
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [nameInput, setNameInput] = useState(''); // Vendor Name (Company)
  const [contactNameInput, setContactNameInput] = useState(''); // Contact Person Name
  const [addressInput, setAddressInput] = useState(''); // Physical Address
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);
  const [legalDropdownOpen, setLegalDropdownOpen] = useState(false);
  const [adminSubTab, setAdminSubTab] = useState<AdminSubTab>('inventory');
  const [legalFilter, setLegalFilter] = useState<string[]>(['All', 'Funded(Original)', 'Funded']);
  const [visibilityFilter, setVisibilityFilter] = useState<string[]>(['Published', 'Hidden', 'Funded(Original)', 'Funded']);
  const [viewMode, setViewMode] = useState<'admin' | 'lender'>('admin');
  const [selectedPO, setSelectedPO] = useState<PurchaseOrder | null>(null);
  const [selectedFundedPO, setSelectedFundedPO] = useState<PurchaseOrder | null>(null);
  const [reservationAmount, setReservationAmount] = useState<number>(0);
  const [selectedPaymentOption, setSelectedPaymentOption] = useState<PaymentOption>(paymentOptions[0]);
  const [reconciledTx, setReconciledTx] = useState<string[]>([]);
  const [paymentForm, setPaymentForm] = useState({ poId: '', amount: 0, type: 'Principal' as 'Principal' | 'Interest' });
  const [capitalModalOpen, setCapitalModalOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingContractId, setEditingContractId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [lenderTab, setLenderTab] = useState<'marketplace' | 'portfolio' | 'profile'>('marketplace');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' | null }>({ key: 'date', direction: 'desc' });
  
  // App State
  const [pos, setPos] = useState<PurchaseOrder[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [investors, setInvestors] = useState<InvestorProfile[]>([]);
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  const activeFundedPOs = pos.filter(
    p => (p.status === 'Funded' || p.status === 'Completed') && p.visibility !== 'Funded(Original)'
  );

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' | null = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    } else if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = null;
    }
    setSortConfig({ key, direction });
  };

  const getSortedData = (data: any[]): any[] => {
    if (!sortConfig.key || !sortConfig.direction) return data;

    return [...data].sort((a, b) => {
      let aValue = a[sortConfig.key];
      let bValue = b[sortConfig.key];

      if (sortConfig.key.includes('.')) {
        const keys = sortConfig.key.split('.');
        aValue = keys.reduce((obj, key) => obj?.[key], a as any);
        bValue = keys.reduce((obj, key) => obj?.[key], b as any);
      }

      if (aValue === bValue) return 0;
      if (aValue === undefined || aValue === null) return 1;
      if (bValue === undefined || bValue === null) return -1;

      if (sortConfig.direction === 'asc') {
        return aValue < bValue ? -1 : 1;
      } else {
        return aValue > bValue ? -1 : 1;
      }
    });
  };

  const handleFirestoreError = (error: any, operationType: string, path: string) => {
    const errInfo = {
      error: error.message,
      operationType,
      path,
      authInfo: {
        userId: auth.currentUser?.uid,
        email: auth.currentUser?.email,
        emailVerified: auth.currentUser?.emailVerified,
        isAnonymous: auth.currentUser?.isAnonymous,
      }
    };
    console.error('Firestore Error: ', JSON.stringify(errInfo));
    // Re-throw if it's a permission error as per instructions
    if (error.code === 'permission-denied') {
      throw new Error(JSON.stringify(errInfo));
    }
  };

  // Firebase Data Listeners
  useEffect(() => {
    if (!user) return;

    const unsubPOs = onSnapshot(collection(db, 'purchaseOrders'), 
      (snapshot) => {
        setPos(snapshot.docs.map(doc => doc.data() as PurchaseOrder));
      },
      (error) => handleFirestoreError(error, 'list', 'purchaseOrders')
    );

    const unsubRes = onSnapshot(collection(db, 'reservations'), 
      (snapshot) => {
        setReservations(snapshot.docs.map(doc => doc.data() as Reservation));
      },
      (error) => handleFirestoreError(error, 'list', 'reservations')
    );

    const unsubInv = onSnapshot(collection(db, 'investors'), 
      (snapshot) => {
        setInvestors(snapshot.docs.map(doc => doc.data() as InvestorProfile));
      },
      (error) => handleFirestoreError(error, 'list', 'investors')
    );

    const unsubContracts = onSnapshot(collection(db, 'contracts'), 
      (snapshot) => {
        setContracts(snapshot.docs.map(doc => doc.data() as Contract));
      },
      (error) => handleFirestoreError(error, 'list', 'contracts')
    );

    const unsubTransactions = onSnapshot(collection(db, 'transactions'), 
      (snapshot) => {
        setTransactions(snapshot.docs.map(doc => doc.data() as BankTransaction));
      },
      (error) => handleFirestoreError(error, 'list', 'transactions')
    );

    const unsubConfig = onSnapshot(doc(db, 'config', 'system'), 
      (snapshot) => {
        if (snapshot.exists()) {
          setLastSyncTime(snapshot.data().lastAcumaticaSync);
        }
      },
      (error) => handleFirestoreError(error, 'get', 'config/system')
    );

    return () => {
      unsubPOs();
      unsubRes();
      unsubInv();
      unsubContracts();
      unsubTransactions();
      unsubConfig();
    };
  }, [user]);

  // Firebase Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser && firebaseUser.email) {
        const email = firebaseUser.email.toLowerCase();
        const role: UserRole = email.endsWith('@svjbrands.com') ? 'admin' : 'lender';
        const userData = { email: firebaseUser.email, role, uid: firebaseUser.uid };
        setUser(userData as any);

        // Sync user to Firestore for rules
        try {
          await setDoc(doc(db, 'users', firebaseUser.uid), userData, { merge: true });
        } catch (err) {
          console.error('Error syncing user to Firestore:', err);
        }
      } else {
        setUser(null);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Sync viewMode with user role on login
  useEffect(() => {
    if (user && !authLoading) {
      setViewMode(user.role === 'admin' ? 'admin' : 'lender');
    }
  }, [user, authLoading]);

  const calculateAUM = () => {
    let total = 0;
    if (adminSubTab === 'inventory') {
      total = pos
        .filter(p => {
          const visibility = p.visibility || 'None';
          return visibilityFilter.includes(visibility);
        })
        .reduce((acc, po) => acc + po.amount, 0);
    } else if (adminSubTab === 'reservations') {
      total = reservations
        .filter(r => r.status === 'Pending')
        .reduce((acc, r) => acc + r.amount, 0);
    } else if (adminSubTab === 'legal') {
      total = reservations
        .filter(r => r.status === 'Accepted' && !pos.find(p => p.id === r.poId && (p.status === 'Funded' || p.status === 'Completed')))
        .reduce((acc, r) => acc + r.amount, 0);
    } else if (adminSubTab === 'finance') {
      total = activeFundedPOs.reduce((acc, po) => acc + po.amount, 0);
    }
    return total.toLocaleString(undefined, { minimumFractionDigits: 2 });
  };

  const handleAcumaticaSync = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch('/api/acumatica/sync');
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to sync with Acumatica');
      }
      
      const rawData = await res.json();
      const posData = Array.isArray(rawData.pos) ? rawData.pos : (rawData.pos?.value || []);
      const vendorsData = Array.isArray(rawData.vendors) ? rawData.vendors : (rawData.vendors?.value || []);
      
      // Create vendor map for quick lookup
      const vendorNameMap = new Map();
      vendorsData.forEach((v: any) => {
        if (v.VendorID?.value) {
          vendorNameMap.set(v.VendorID.value, v.VendorName?.value || '');
        }
      });

      const newPOs = posData.map((po: any) => {
        const items = (po.Details || []).map((item: any) => ({
          id: item.id || Math.random().toString(36).substr(2, 9),
          inventoryId: item.InventoryID?.value || 'N/A',
          description: item.LineDescription?.value || item.Description?.value || 'No description',
          uom: item.UOM?.value || 'EA',
          quantity: item.OrderQty?.value || 0,
          unitCost: item.UnitCost?.value || 0,
          extCost: item.LineAmount?.value || item.ExtendedCost?.value || 0,
          qtyOnReceipts: item.QtyOnReceipts?.value || 0,
          receivedAmount: item.ReceivedAmount?.value || 0
        }));

        const vendorId = po.VendorID?.value;
        const vendorName = po.VendorName?.value || vendorNameMap.get(vendorId) || '';
        
        // Check if PO already exists to preserve visibility and other fields
        const existingPO = pos.find(p => p.id === po.OrderNbr?.value);
        const originalLinkedPO = pos.find(p => p.reissuedPoId === po.OrderNbr?.value);
        
        let visibility = existingPO?.visibility;
        let status = existingPO?.status || 'To be Shipped';
        
        if (po.Description?.value?.startsWith('Finance Portal') && existingPO?.visibility !== 'Hidden') {
          visibility = 'Funded';
          status = 'Funded';
        } else if (!visibility) {
          if (existingPO?.isPublished) {
            visibility = 'Published';
          } else {
            visibility = 'Hidden';
          }
        }

        const calculatedOrderQty = items.reduce((acc: number, item: any) => acc + item.quantity, 0);
        const calculatedOpenQty = items.reduce((acc: number, item: any) => acc + Math.max(0, item.quantity - item.qtyOnReceipts), 0);
        const orderTotal = po.OrderTotal?.value || 0;

        return {
          id: po.OrderNbr?.value,
          poNumber: po.OrderNbr?.value,
          originalPoId: existingPO?.originalPoId || originalLinkedPO?.id,
          originalPoNumber: existingPO?.originalPoNumber || originalLinkedPO?.poNumber,
          vendor: vendorId,
          vendorName: vendorName,
          amount: orderTotal,
          totalQuantity: calculatedOrderQty,
          orderQty: calculatedOrderQty,
          openQty: calculatedOpenQty,
          status: status,
          description: po.Description?.value || `Acumatica PO: ${po.OrderNbr?.value}`,
          date: po.OrderDate?.value ? new Date(po.OrderDate.value).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
          location: po.Branch?.value || 'Main Warehouse',
          owner: 'Acumatica Sync',
          items: items,
          isPublished: existingPO ? existingPO.isPublished : false,
          visibility: visibility
        };
      });

      // Identify POs that are no longer in Acumatica (Closed)
      const newPOIds = new Set(newPOs.map(po => po.id));
      const closedPOs = pos.filter(po => !newPOIds.has(po.id));

      // Extract unique vendors
      const uniqueVendors = new Map();
      newPOs.forEach(po => {
        if (po.vendor && !uniqueVendors.has(po.vendor)) {
          uniqueVendors.set(po.vendor, {
            id: po.vendor,
            vendorId: po.vendor,
            vendorName: po.vendorName,
            lastSynced: new Date().toISOString()
          });
        }
      });

      // Batch write to Firestore
      for (const po of newPOs) {
        await setDoc(doc(db, 'purchaseOrders', po.id), po, { merge: true })
          .catch(err => handleFirestoreError(err, 'write', `purchaseOrders/${po.id}`));
      }

      // Handle Closed POs: If they are in initial state, remove them. 
      // If they are reserved/accepted/funded, keep them but mark as closed in Acumatica if needed.
      for (const po of closedPOs) {
        if (po.status === 'To be Shipped' && !po.reservedBy) {
          // It was never reserved or published, just remove it as it's closed in Acumatica
          await deleteDoc(doc(db, 'purchaseOrders', po.id))
            .catch(err => handleFirestoreError(err, 'delete', `purchaseOrders/${po.id}`));
        } else {
          // It's in the platform workflow, keep it but maybe update status if it's not already funded
          // For now, we just keep it as is to preserve the platform state
        }
      }

      // Save unique vendors
      for (const vendor of uniqueVendors.values()) {
        await setDoc(doc(db, 'vendors', vendor.id), vendor, { merge: true })
          .catch(err => handleFirestoreError(err, 'write', `vendors/${vendor.id}`));
      }

      // Log the sync action to DB
      const syncLogId = `log-${Date.now()}`;
      await setDoc(doc(db, 'syncLogs', syncLogId), {
        id: syncLogId,
        timestamp: new Date().toISOString(),
        user: user?.email || 'System',
        newPOsCount: newPOs.length,
        closedPOsCount: closedPOs.length,
        vendorsCount: uniqueVendors.size,
        status: 'Success'
      }).catch(err => console.error('Failed to write sync log:', err));

      await setDoc(doc(db, 'config', 'system'), {
        lastAcumaticaSync: new Date().toISOString()
      }, { merge: true }).catch(err => handleFirestoreError(err, 'write', 'config/system'));

      setLastSyncTime(new Date().toISOString());
      alert(`Successfully synced ${newPOs.length} POs from Acumatica.`);
    } catch (error: any) {
      console.error('Sync error:', error);
      
      // Log the failure to DB
      const syncLogId = `log-${Date.now()}`;
      await setDoc(doc(db, 'syncLogs', syncLogId), {
        id: syncLogId,
        timestamp: new Date().toISOString(),
        user: user?.email || 'System',
        error: error.message,
        status: 'Failed'
      }).catch(err => console.error('Failed to write error sync log:', err));

      alert(`Sync failed: ${error.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  // Simulate DocuSign automatic sync
  useEffect(() => {
    const interval = setInterval(() => {
      const hasSentContracts = contracts.some(c => c.status === 'Sent');
      if (hasSentContracts) {
        handleSyncDocuSign();
      }
    }, 15000); // Check every 15 seconds
    return () => clearInterval(interval);
  }, [contracts]);

  // Derived state for the current lender
  const currentLender = useMemo(() => {
    if (!user) return null;
    
    const uid = (user as any).uid;
    const existingInvestor = investors.find(i => i.id === uid);
    
    if (existingInvestor) {
      console.log('Found existing lender profile:', existingInvestor);
      return existingInvestor;
    }
    
    // If user is admin but in lender view, or a new lender, provide a profile
    if (user.role === 'admin' || user.role === 'lender') {
      const profile = {
        id: uid,
        name: user.email?.split('@')[0].charAt(0).toUpperCase() + user.email?.split('@')[0].slice(1),
        email: user.email || '',
        totalInvested: 0,
        activeReservations: 0
      };
      console.log('Using generated lender profile:', profile);
      return profile;
    }
    return null;
  }, [user, investors]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Login error:', error);
      alert('Failed to sign in with Google. Please try again.');
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput || !passwordInput) return;
    setIsSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, emailInput, passwordInput);
    } catch (error: any) {
      console.error('Email login error:', error);
      if (error.code === 'auth/invalid-credential') {
        alert('Invalid email or password. If you haven\'t registered yet, please use the "Register Entity" link below.');
      } else if (error.code === 'auth/user-not-found') {
        alert('No account found with this email. Please register first.');
      } else if (error.code === 'auth/wrong-password') {
        alert('Incorrect password. Please try again.');
      } else if (error.code === 'auth/account-exists-with-different-credential') {
        alert('An account already exists with this email using a different sign-in method (e.g. Google). Please use that method to sign in.');
      } else {
        alert(`Login failed: ${error.message}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput || !passwordInput || !nameInput || !contactNameInput || !addressInput) {
      alert('Please fill in all fields, including the physical address.');
      return;
    }
    setIsSubmitting(true);
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, emailInput, passwordInput);
      
      const res = await fetch('/api/vendor/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          vendorName: nameInput,
          contactName: contactNameInput,
          address: addressInput,
          email: emailInput,
          uid: userCredential.user.uid
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to register vendor in Acumatica');
      }

      const { vendorId } = await res.json();

      const newInvestor: InvestorProfile = {
        id: userCredential.user.uid,
        name: nameInput,
        contactName: contactNameInput,
        address: addressInput,
        email: emailInput,
        vendorId: vendorId,
        totalInvested: 0,
        activeReservations: 0
      };
      
      await setDoc(doc(db, 'investors', userCredential.user.uid), newInvestor)
        .catch(err => handleFirestoreError(err, 'write', `investors/${userCredential.user.uid}`));

      alert('Vendor account created successfully! Please sign in with your credentials.');
      await signOut(auth);
      setLoginMode('login');
      setEmailInput('');
      setPasswordInput('');
      setNameInput('');
      setContactNameInput('');
      setAddressInput('');
    } catch (error: any) {
      console.error('Signup error:', error);
      alert(`Signup failed: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentLender) return;
    setIsSubmitting(true);
    try {
      const res = await fetch('/api/vendor/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorId: currentLender.vendorId,
          vendorName: nameInput,
          contactName: contactNameInput,
          address: addressInput,
          email: emailInput
        })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to update vendor in Acumatica');
      }

      await updateDoc(doc(db, 'investors', currentLender.id), {
        name: nameInput,
        contactName: contactNameInput,
        address: addressInput,
        email: emailInput
      }).catch(err => handleFirestoreError(err, 'write', `investors/${currentLender.id}`));

      alert('Profile updated and synced with Acumatica successfully!');
    } catch (error: any) {
      console.error('Update profile error:', error);
      alert(`Update failed: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setAdminSubTab('inventory');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const handleSubmitReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPO) {
      alert('No PO selected.');
      return;
    }
    if (!currentLender) {
      alert('Lender profile not found. Please ensure you are logged in as a lender and your profile is complete.');
      return;
    }
    if (isSubmitting) return;
    
    if (reservationAmount <= 0 || reservationAmount > selectedPO.amount) {
      alert('Please enter a valid reservation amount.');
      return;
    }

    // Check if this lender already has a pending/accepted reservation for this PO
    const existingRes = reservations.find(r => r.poId === selectedPO.id && r.investorId === currentLender?.id && r.status !== 'Rejected');
    if (existingRes) {
      alert('You have already submitted a reservation for this purchase order.');
      setSelectedPO(null);
      return;
    }

    setIsSubmitting(true);
    console.log('Submitting reservation...', { selectedPO, currentLender, reservationAmount });

    const resId = `res-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const newReservation: Reservation = {
      id: resId,
      poId: selectedPO.id,
      investorId: currentLender.id,
      amount: reservationAmount,
      paymentOption: selectedPaymentOption,
      status: 'Pending',
      timestamp: new Date().toISOString()
    };

    try {
      console.log('Creating reservation document...', resId);
      // 1. Create the reservation document
      await setDoc(doc(db, 'reservations', resId), newReservation)
        .catch(err => handleFirestoreError(err, 'write', `reservations/${resId}`));

      console.log('Updating purchase order status...', selectedPO.id);
      // 2. Update the PO status
      await updateDoc(doc(db, 'purchaseOrders', selectedPO.id), {
        reservedBy: currentLender.id,
        reservationStatus: 'Pending'
      }).catch(err => handleFirestoreError(err, 'write', `purchaseOrders/${selectedPO.id}`));
      
      console.log('Reservation successful!');
      alert('Reservation submitted successfully! The administrator will review your request.');
      setSelectedPO(null);
      setReservationAmount(0);
    } catch (error: any) {
      console.error('Reservation error:', error);
      // handleFirestoreError already throws, but we catch it here to stop isSubmitting
      // and potentially show a more user-friendly message if it wasn't a permission error
      if (!error.message.includes('permission')) {
        alert(`Failed to submit reservation: ${error.message}`);
      } else {
        try {
          const errInfo = JSON.parse(error.message);
          alert(`Permission Denied: You do not have access to ${errInfo.operationType} at ${errInfo.path}. Please ensure your profile is complete.`);
        } catch (e) {
          alert('Permission Denied: You do not have sufficient permissions to perform this action.');
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const generateContractPDF = (contract: Contract, investor: InvestorProfile, po: PurchaseOrder, reservation: Reservation) => {
    const doc = new jsPDF();
    const margin = 20;
    let y = 20;
    const pageWidth = doc.internal.pageSize.getWidth();
    const contentWidth = pageWidth - (margin * 2);

    const addText = (text: string, fontSize = 9, fontStyle = "normal", spacing = 5) => {
      doc.setFontSize(fontSize);
      doc.setFont("helvetica", fontStyle);
      const lines = doc.splitTextToSize(text, contentWidth);
      
      lines.forEach((line: string) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        doc.text(line, margin, y);
        y += spacing;
      });
      y += 2; // Extra gap after block
    };

    const addHeading = (text: string, fontSize = 11, spacing = 8) => {
      if (y > 260) {
        doc.addPage();
        y = 20;
      }
      doc.setFontSize(fontSize);
      doc.setFont("helvetica", "bold");
      doc.text(text, margin, y);
      y += spacing;
    };

    // Title
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("MASTER CONSIGNMENT & SUPPLY AGREEMENT", pageWidth / 2, y, { align: "center" });
    y += 15;

    const effectiveDate = new Date(contract.generatedDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const intro = `This Master Consignment & Supply Agreement (this “Agreement”) is made as of ${effectiveDate} (“Effective Date”), by and between, ${investor.name}, a limited liability company located at ${investor.address || '____________________________________'} (“Consignor”) on one hand, and SVJ Packaging LLC, a Wyoming limited liability company with a mailing address at 1021 E Lincoln Way, Unit #839, Cheyenne, WY 82001 (“Consignee”) on other hand. Consignor and Consignee shall be individually known as “Party” and collectively known as “Parties.”`;
    addText(intro, 9, "normal", 5);

    addHeading("1. Purpose; Commercial Supply Relationship.");
    addText("1.1 Consignment Model. The Parties enter into this Agreement to establish a vendor-managed inventory arrangement under which Consignor will: (i) source, purchase, import, and warehouse certain goods for Consignee on a consignment basis; and (ii) make such goods available for Consignee to withdraw on demand. Consignee will purchase and take title to goods only upon withdrawal in accordance with this Agreement.");
    addText("1.2 No Financing Intent. The Parties intend this Agreement to be a bona fide commercial consignment and supply arrangement and not a loan, credit facility, or other financial instrument. No provision will be interpreted to create an unconditional obligation for Consignee to repurchase all inventory, and Consignor retains meaningful incidents of ownership risk and third-party sale rights as described below.");

    addHeading("2. Definitions.");
    addText("“Consignment Goods” means hardware (including vape devices) and packaging materials (including bags, boxes, master cases, displays, and related components) sourced from manufacturers (including in China) to Consignee’s specifications and identified in an applicable Stock Schedule.");
    addText("“Consignment Location” means Consignor’s domestic warehouse facility(ies) identified in Section 6.");
    addText("“Holding Period” means, for each lot/SKU delivered into consignment, the maximum time the applicable Consignment Goods may remain in consignment before the End-of-Hold Remedies apply, as set forth in the applicable Stock Schedule and not to exceed 120 days from Consignor’s first payment to the vendor for such Consignment Goods unless stated herein.");
    addText("“Purchase Price” means, for each unit of Consignment Goods withdrawn by Consignee, the price equal to: (i) Consignor’s documented acquisition cost for that unit (inclusive of manufacturer invoice amounts) (‘Cost”) plus (ii) an agreed supply/handling/risk margin (the “Margin”) of either, (A), if the Withdrawal occurs within 60 days of first vendor payment, then 10% of Cost; or (B) if the Withdrawal occurs within 61-90 days of first vendor payment, then 12% of Cost; or (C) if the Withdrawal occurs within 91-120 days of first vendor payment, then 15% of Cost.");
    addText("“Stock Schedule” means a statement of work, stock schedule, product line addendum, or similar document executed by the Parties that sets forth SKU specifications, ordering procedures, target stock levels, Holding Period, ROFR process (if any), Purchase Price mechanics.");
    addText("“Withdrawal” means Consignee’s removal (or shipment at Consignee’s direction) of Consignment Goods from the Consignment Location for Consignee’s use or sale.");

    addHeading("3. Scope; Procurement; Importation.");
    addText("3.1 Procurement. Consignor will purchase Consignment Goods from manufacturers and suppliers selected by Consignee or reasonably acceptable to Consignee, in quantities consistent with the applicable Stock Schedule.");
    addText("3.2 Consignee Specifications. Consignee will provide specifications, packaging artwork, compliance requirements, and other requirements reasonably necessary for procurement. Consignor will procure Consignment Goods in accordance with such specifications in the applicable Stock Schedule.");
    addText("3.3 Importer of Record; Customs. Consignor will act as importer of record (or otherwise import under its own license) and will clear customs at its own cost and risk, except as expressly allocated in an applicable Stock Schedule.");
    addText("3.4 Shipping & Freight. Consignor shall import all Consignment Goods using freight forwarders approved by Consignee from Consignee’s approved forwarder list, provided in an applicable Stock Schedule. Consignor shall carry the minimum required cargo insurance to eliminate risk of loss during transit. Consignee may update the approved forwarder list at any time upon written notice.");
    addText("3.5 Regulatory Acknowledgment. The Parties acknowledge that certain Consignment Goods may be components used in cannabis and hemp products and may be subject to varying federal, state, and local laws. Each Party will comply with Applicable Law (defined below) within its respective area of responsibility.");

    addHeading("4. Title; Risk of Loss; Insurance.");
    addText("4.1 Title. Consignor shall hold title to all Consignment Goods from the point of vendor purchase through import, customs clearance, and warehousing. Title to Consignment Goods remains with Consignor until Withdrawal. Title transfers to Consignee at the time of Withdrawal from the Consignment Location.");
    addText("4.2 Risk of Loss (Pre-Withdrawal). Prior to Withdrawal, Consignor bears risk of loss, theft, damage, or destruction of Consignment Goods while in Consignor’s possession or control at the Consignment Location, except to the extent caused by Consignee’s personnel while on-site. To be clear risk of loss switches once Consignment Goods leaves Consignment Location.");
    addText("4.3 Risk of Loss (Post-Withdrawal). Upon Withdrawal, risk of loss passes to Consignee.");
    addText("4.4 Insurance.");
    addText("Consignor Coverage. Consignor will maintain commercially reasonable insurance covering the Consignment Goods while in Consignor’s possession, including property insurance (inventory) and warehouse legal liability, in amounts customary for a warehouse operator handling similar goods but no less than the wholesale value of the Consignment Goods. Thus at a minimum, Consignor shall maintain insurance covering the full wholesale replacement value of all Consignment Goods in its possession.");
    addText("Consignee Coverage. Consignee will maintain commercially reasonable insurance for the Consignment Goods after Withdrawal.");
    addText("Certificates. Upon request, each Party will provide certificates of insurance evidencing the coverage required under this Section.");

    addHeading("5. Operations; Forecasting; Ordering.");
    addText("5.1 Forecasts. Consignee will provide rolling forecasts by SKU/product line at intervals specified in the applicable Stock Schedule. Forecasts are for planning purposes unless expressly stated as binding minimum commitments under Stock Schedule.");
    addText("5.2 Replenishment. Consignor will manage replenishment and procurement to maintain stock levels within the agreed minimum and maximum thresholds set forth in the Stock Schedule, if any.");
    addText("5.3 No Unbounded Accumulation. Consignor is responsible for all inventory beyond the amounts ordered by Consignee by a valid Purchase Order. Without prior written approval, Consignee is not obligated to purchase any excess inventory.");
    addText("5.4 Records. Consignor will maintain accurate books and records of inventory receipts, on-hand quantities, withdrawals, and disposition by SKU/lot.");
    addText("5.5 Reporting. Consignor shall provide Consignee with a monthly inventory report showing quantities on hand by SKU, acquisition cost, date of first vendor payment, and aging. Reports are due by the fifth (5th) business day of each month.");

    addHeading("6. Warehousing; Handling; Access; Audits.");
    addText(`6.1 Consignment Location. The Consignment Location(s) is/are: ${po.location || '[ADDRESS(ES)]'}. Consignor shall warehouse all Consignment Goods at its own facility and sole cost, maintaining commercially reasonable storage conditions based on Consignee’s requirements set forth in the Stock Schedule.`);
    addText("6.2 Warehousing Costs. Consignor bears all storage, handling, and facility costs for the Consignment Goods while held in consignment.");
    addText("6.3 Withdrawal Process. Consignee may request Withdrawal by written notice (email shall suffice), or other agreed method specifying quantities and delivery instructions. Consignor will either: (i) prepare Purchased Goods for pickup; or (ii) ship withdrawn Purchased Goods to Consignee’s designated facility within 5 business days after receipt of a request. Consignor shall be responsible for Purchased Goods until the Purchased Goods are picked up pursuant to Section 6.3(i) or shipped Purchased Goods pursuant to Section 6.3(ii).");
    addText("6.4 Audit Rights. Consignee may, no more than 2 times per year (or more frequently upon reasonable suspicion of discrepancy), audit inventory records and perform cycle counts during normal business hours on reasonable notice.");

    addHeading("7. Pricing; Commercial Basis; Separate Service Fees.");
    addText("7.1 Commercial Basis of Margin. The Parties agree the Margin is a commercially reasonable supply/handling/risk premium intended to compensate Consignor for services and risks including procurement management, importation work, customs clearance, warehousing, insurance, shrink, and capital deployment.");
    addText("7.2 Cost Support. Consignor will maintain reasonable documentation of manufacture costs and will make summary support available to Consignee upon reasonable request.");

    addHeading("8. Withdrawal; Invoicing; Payment; Taxes.");
    addText("8.1 Payment Trigger. Consignee’s payment obligation arises only upon Withdrawal of Consignment Goods.");
    addText("8.2 Invoicing. Consignor will invoice Consignee following each Withdrawal (or on a periodic consolidated basis, if agreed) stating SKU, quantity, unit Purchase Price, and total amount due.");
    addText("8.3 Payment Terms. Consignee will pay each undisputed invoice within NET 15 days after invoice date.");
    addText("8.4 Taxes. Consignee is responsible for sales/use and similar taxes arising from the sale of Consignment Goods upon Withdrawal, except to the extent exemption certificates are provided or Applicable Law places liability on Consignor.");

    addHeading("9. Stock Level Caps; Facility Limits.");
    addText("9.1 Min/Max Levels. For each product line, the applicable Stock Schedule will specify minimum or maximum on-hand levels (units and/or dollar value) and reorder parameters. Consignee is only obligated to purchase the amounts of Consignment Goods specified in a valid Purchase Order without prior written approval.");

    addHeading("10. Quality; Inspection; Defects");
    addText("10.1 Incoming Quality Control. Consignor will perform commercially reasonable receiving inspections and will follow any additional quality control steps specified in the Stock Schedule.");
    addText("10.2 Defective Goods (Pre-Withdrawal). Consignor bears the risk of defects, nonconformity, seizure, detention, loss, or damage while goods are owned by Consignor, including while in transit to the Consignment Location and while stored at the Consignment Location, subject to Section 11(d).");
    addText("10.3 Defective Goods (Post-Withdrawal). After Withdrawal, Consignee bears risk of defects or nonconformity to the extent caused by Consignee’s storage, handling, modification, or misuse.");
    addText("10.4 Vendor Claims. Consignee will pursue claims against the manufacturer, shipper, carrier, and/or insurer for defects, loss, or damage occurring prior to Withdrawal. Consignor will reasonably cooperate (including providing documentation) as needed.");
    addText("10.5 Remedies. The Stock Schedule may include replacement, credit, or return processes. Consignor may elect to replace nonconforming goods with conforming goods if commercially feasible.");

    addHeading("11. Holding Period; Third-Party Sale Rights; ROFR");
    addText("11.1 Holding Period. Each lot/SKU is subject to a Holding Period defined in this Agreement.");
    addText("11.2 End-of-Hold Notice. Consignor will provide Consignee at least 30 days’ prior written notice before the end of the applicable Holding Period for any material inventory position.");
    addText("11.3 Right of First Refusal. Prior to selling to a third-party, Consignor will offer Consignee the right to purchase the applicable goods at the then-applicable Purchase Price (or other ROFR price defined in the Stock Schedule). Consignee must accept in writing within 10 Business Days.");
    addText("11.4 Third-Party Sale Rights (Mandatory). If Consignee does not purchase the goods within the Holding Period (and, if applicable, declines or fails to timely exercise its ROFR), Consignor may, in its discretion and without liability to Consignee: (i) sell such goods to third-parties; (ii) liquidate such goods through customary channels; and/or (iii) return such goods to the manufacturer or vendor (if commercially feasible), in each case subject to Applicable Law and any reasonable brand/proprietary restrictions expressly set forth in the Stock Schedule.");
    addText("11.5 No Restriction Creating De Facto Exclusive Buyer. No provision of this Agreement will be interpreted to prohibit Consignor from selling eligible goods to third-parties as permitted by this Section 12.");

    addHeading("12. Intellectual Property; Specifications; Tooling.");
    addText("12.1 Consignee IP. As between the Parties, Consignee retains all rights in its trademarks, artwork, packaging designs, product specifications, and other Consignee materials provided to Consignor and/or used with, or related to the Consignment Goods");
    addText("12.2 Limited License. Consignee grants Consignor a limited, non-exclusive, non-transferable license to use Consignee materials solely to perform under this Agreement. This Limited License does not grant Consignor a license to make, use, sell, offer to sell, promote or advertise any Consignee IP to or in connection with third parties purchase of Consignment Goods, and Consignor is expressly prohibited from making, using, selling or offering to sell, promoting or advertising any Consignee IP to anyone other than to or for Consignee.");
    addText("12.3 Tooling. Any tooling, molds, or dies paid for by Consignee will be Consignee’s property; title and access rights will be addressed in the Stock Schedule.");

    addHeading("13. Compliance; Cannabis/Hemp Regulatory Overlay.");
    addText("13.1 Applicable Law. Each Party will comply with all applicable federal, state, and local laws, rules, and regulations (collectively, “Applicable Law”) in connection with its performance under this Agreement, including import/export and customs laws, anti-bribery laws, sanctions, and trade compliance.");
    addText("13.2 Controlled Substances; Use Case. The Parties acknowledge that certain goods may be used in connection with cannabis or hemp products that may be legal under some state laws but remain restricted under federal law. Each Party will be responsible for ensuring its own operations comply with Applicable Law, including licensing and permitting requirements applicable to its activities.");
    addText("13.3 Regulatory Change. If a change in Applicable Law materially increases a Party’s cost or risk of performance, the Parties will meet promptly to discuss a commercially reasonable adjustment (including changes to products, packaging, processes, pricing, or termination of affected Stock Schedules).");

    addHeading("14. Term; Termination; Transition");
    addText("14.1 Term. This Agreement will begin on the Effective Date and continue for an initial term of 1 year, renewing automatically for successive 1-year terms unless terminated hereunder.");
    addText("14.2 Termination for Convenience. Either Party may terminate this Agreement for convenience upon 90 days’ prior written notice; provided that termination does not affect any Withdrawal payments due for goods previously withdrawn.");
    addText("14.3 Termination for Cause. Either Party may terminate this Agreement upon written notice if the other Party materially breaches and fails to cure within 30 days after notice.");
    addText("14.4 Insolvency. Either Party may terminate immediately upon the other Party’s insolvency, assignment for benefit of creditors, bankruptcy filing, or appointment of a receiver.");
    addText("14.5 Transition; Remaining Inventory. Upon expiration or termination:");
    addText("(a) Consignee may continue to Withdraw goods during a transition period of 90 days on the same terms (unless terminated for Consignee’s uncured breach).");
    addText("(b) After the transition period, remaining inventory will be handled in accordance with Section 12 (third-party sale, liquidation, or return to vendor), subject to any ROFR process.");
    addText("(c) Each Party will return or destroy the other Party’s Confidential Information (defined below) upon request, subject to archival/legal requirements.");

    addHeading("15. Confidentiality.");
    addText("15.1 Confidential Information. “Confidential Information” means non-public information disclosed by a Party relating to its business, pricing, customers, specifications, sourcing, inventory, or operations, whether disclosed orally, visually, or in writing, and whether marked confidential or not, that a reasonable person would understand to be confidential.");
    addText("15.2 Obligations. Each receiving Party will: (i) use the disclosing Party’s Confidential Information only to perform under this Agreement; (ii) protect it using at least the same care it uses to protect its own confidential information of similar sensitivity; and (iii) not disclose it except to its agents, attorneys, employees, contractors and/or service providers (“Representatives”) who need to know and are bound by confidentiality obligations.");
    addText("15.3 Exclusions. Confidential Information does not include information that the receiving Party can demonstrate: (i) is or becomes public through no breach; (ii) was known to the receiving Party without restriction before receipt; (iii) is received from a third-party without breach; or (iv) is independently developed without use of the disclosing Party’s information.");
    addText("15.4 Compelled Disclosure. A Party may disclose Confidential Information to the extent required by law or legal process, provided it gives prompt notice (if permitted) and cooperates to seek protective treatment.");
    addText("15.5 Survival. These obligations will survive for 3 YEARS after termination, and trade secret obligations survive as long as protected by law.");

    addHeading("16. Indemnification; Limitation of Liability.");
    addText("16.1 Consignor Indemnity. Consignor will indemnify, defend, and hold harmless Consignee and its affiliates and their respective officers, directors, managers, members, employees, and agents from and against third-party claims arising out of: (i) Consignor’s importation/customs clearance activities; (ii) bodily injury or property damage caused by Consignor’s negligence in warehousing/handling prior to Withdrawal; (iii) Consignor’s breach of Applicable Law; or (iv) or Consignor’s breach of this Agreement.");
    addText("16.2 Consignee Indemnity. Consignee will indemnify, defend, and hold harmless Consignor and its affiliates and their respective officers, directors, managers, members, employees, and agents from and against third-party claims arising out of: (i) Consignee’s use, marketing, or sale of goods after Withdrawal except if caused by Consignor; (ii) Consignee’s breach of Applicable Law in its downstream operations; or (iii) Consignee’s breach of this Agreement.");
    addText("16.3 Procedure. The indemnified Party will provide prompt notice, reasonable cooperation, and control of defense to the indemnifying Party (subject to rights to separate counsel for conflicts).");
    addText("16.4 Limitation of Liability. Except for: (i) a Party’s indemnification obligations; (ii) breach of confidentiality; or (iii) fraud, gross negligence, or willful misconduct, neither Party will be liable for indirect, incidental, consequential, special, exemplary, or punitive damages.");

    addHeading("17. Dispute Resolution; Jury Trial Waiver.");
    addText("17.1 Good Faith Escalation. Before commencing litigation or arbitration, the Parties will attempt in good faith to resolve disputes through executive escalation.");
    addText("17.2 Arbitration. Any dispute arising out of or relating to this Agreement will be resolved by binding arbitration administered by the American Arbitration Association under its Commercial Arbitration Rules, seated in [CITY, STATE], before one arbitrator. The prevailing party shall recover its reasonable attorneys’ fees and costs.");
    addText("17.3 Jury Trial Waiver. TO THE FULLEST EXTENT PERMITTED BY LAW, EACH PARTY WAIVES ANY RIGHT TO A TRIAL BY JURY IN ANY ACTION OR PROCEEDING ARISING OUT OF OR RELATING TO THIS AGREEMENT.");

    addHeading("18. Governing Law.");
    addText("This Agreement will be governed by the laws of the State of [GOVERNING LAW STATE], without regard to conflict of laws principles.");

    addHeading("19. Assignment.");
    addText("Neither Party may assign this Agreement without the prior written consent of the other Party, except that either Party may assign this Agreement without consent to an affiliate or in connection with a merger, consolidation, or sale of substantially all assets, provided the assignee assumes the assigning Party’s obligations.");

    addHeading("20. Consignor Qualifications; Conditions Precedent.");
    addText("Consignor’s obligations to hold stock are conditioned on Consignor maintaining throughout the Term:");
    addText("(a) all licenses and permits required for importation and warehousing activities;");
    addText("(b) operational capability to receive, store, and ship goods consistent with the Stock Schedules;");
    addText("(c) commercially reasonable policies and procedures for inventory security and loss prevention; and");
    addText("(d) the insurance coverages described in Section 4.");

    addHeading("21. Miscellaneous");
    addText("21.1 Independent Contractors. The Parties are independent contractors. Nothing creates a partnership, joint venture, employment, fiduciary, or agency relationship.");
    addText("21.2 Force Majeure. Neither Party will be liable for failure to perform due to events beyond its reasonable control, including acts of God, war, terrorism, labor disputes, or governmental action; provided the affected Party provides prompt notice and uses commercially reasonable efforts to mitigate.");
    addText("21.3 Notices. Notices must be in writing and delivered by personal delivery, overnight courier, or email with confirmation to the addresses set forth below (or as updated by notice).");
    addText(`If to Consignor: ${investor.name}, ${investor.email}, ${investor.address || '____________________'}`);
    addText("If to Consignee: SVJ Packaging LLC, 1021 E Lincoln Way, Unit #839, Cheyenne, WY 82001, umar.tahir@svjbrands.com");
    addText("21.4 Entire Agreement; Order of Precedence. This Agreement and all Stock Schedules are the entire agreement. If there is a conflict, the following order controls: (i) Stock Schedule (for the specific product line), then (ii) this Agreement.");
    addText("21.5 Amendments; Waivers. Any amendment or waiver must be in a writing signed by both Parties.");
    addText("21.6 Severability. If any provision is invalid, the remainder remains enforceable.");
    addText("21.7 Counterparts; Electronic Signatures. Counterparts and electronic signatures are effective.");

    addText("[remainder of this page left intentionally blank; signature page to follow]");

    doc.addPage();
    y = 20;
    addHeading("SIGNATURE PAGE");
    addText("IN WITNESS WHEREOF the Parties hereby execute this Agreement to be effective as of the date set forth above.");
    y += 10;
    
    doc.setFont("helvetica", "bold");
    doc.text(`CONSIGNOR: ${investor.name}`, margin, y);
    y += 15;
    doc.text("By: ________________________", margin, y);
    y += 8;
    doc.text(`Name: ${investor.contactName || '______________________'}`, margin, y);
    y += 8;
    doc.text("Title: _____________________", margin, y);
    y += 20;

    doc.text("CONSIGNEE: SVJ Packaging LLC", margin, y);
    y += 15;
    doc.text("By: ________________________", margin, y);
    y += 8;
    doc.text("Name: Umar Tahir", margin, y);
    y += 8;
    doc.text("Title: Managing Member", margin, y);

    // Exhibit A
    doc.addPage();
    y = 20;
    doc.setFontSize(14);
    doc.setFont("helvetica", "bold");
    doc.text("EXHIBIT “A”", pageWidth / 2, y, { align: "center" });
    y += 10;
    doc.text("Form Stock Schedule (Per Product Line)", pageWidth / 2, y, { align: "center" });
    y += 15;

    addHeading("1. Product Line.");
    addText(`Product Line: ${po.description}`);
    addText(`SKUs/Descriptions: ${po.items.map(i => `${i.inventoryId}: ${i.description}`).join(', ')}`);

    addHeading("2. Stock Levels (Rolling Caps).");
    addText(`Minimum On-Hand: ${po.totalQuantity} The amount ordered by Consignee pursuant to a valid written Purchase Order, minus any withdrawals by Consignee.`);
    addText(`Maximum On-Hand: ${po.totalQuantity} Consignor may stock additional inventory, however, Consignee is not obligated to purchase any additional inventory beyond those specified in a valid written Purchase Order or prior written approval.`);
    addText("Reorder Point / Trigger: Upon issuance of a new Purchase Order by Consignee.");

    addHeading("3. Holding Period.");
    addText("Holding Period: 120 days");
    addText("End-of-Hold Notice Period: 30 days");

    addHeading("4. Minimum Purchase Commitments.");
    addText("Quarterly/Annual Minimum: [__]");

    addHeading("5. Pricing.");
    addText(`Margin: ${reservation.paymentOption.interest}%`);
    addText("As stated in Section 2.4 of the Agreement");

    addHeading("6. Service Levels");
    addText("Withdrawal/Ship SLA: [__] BUSINESS DAYS");
    addText("Packaging/Palletization: [SPEC]");
    addText("Returns Handling: [PROCESS]");

    addHeading("7. Special Terms");
    addText("[INSERT]");

    return doc.output('bloburl').toString();
  };

  const handleFinalizeContract = async (contractId: string) => {
    const contract = contracts.find(c => c.id === contractId);
    if (!contract) return;
    
    const originalPo = pos.find(p => p.reissuedPoId === contract.poId);
    const po = pos.find(p => p.id === contract.poId || (originalPo && p.id === originalPo.id));
    const reservation = reservations.find(r => r.id === contract.reservationId || (originalPo && r.poId === originalPo.id));
    const investor = investors.find(i => i.id === contract.investorId);

    if (!po || !reservation || !investor) {
      alert('Missing data to reissue PO. Please ensure the lender has a complete profile.');
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Update contract status in Firestore
      await updateDoc(doc(db, 'contracts', contractId), { status: 'Signed' })
        .catch(err => handleFirestoreError(err, 'write', `contracts/${contractId}`));
      
      // 2. Call Acumatica PO Reissue API
      console.log('Triggering Acumatica PO Reissue for:', po.poNumber);
      const reissueRes = await fetch('/api/acumatica/po/reissue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poNumber: po.poNumber,
          newVendorId: investor.vendorId,
          markupPercent: reservation.paymentOption.interest,
          lenderName: investor.name
        })
      });

      if (!reissueRes.ok) {
        const errData = await reissueRes.json();
        throw new Error(errData.error || 'Failed to reissue PO in Acumatica');
      }

      const reissueData = await reissueRes.json();
      console.log('PO Reissued successfully:', reissueData);

      const markupMultiplier = 1 + (reservation.paymentOption.interest / 100);
      const reissuedItems = po.items.map(item => ({
        ...item,
        unitCost: Number((item.unitCost * markupMultiplier).toFixed(2)),
        extCost: Number((item.extCost * markupMultiplier).toFixed(2))
      }));
      const reissuedAmount = Number((po.amount * markupMultiplier).toFixed(2));
      
      // 3. Update PO status to Funded in Firestore
      await updateDoc(doc(db, 'purchaseOrders', contract.poId), { 
        status: 'Funded',
        reservationStatus: 'Completed',
        visibility: 'Funded(Original)',
        isPublished: false,
        reservedBy: contract.investorId,
        reissuedPoId: reissueData.newPo
      }).catch(err => handleFirestoreError(err, 'write', `purchaseOrders/${contract.poId}`));

      // 4. Create the reissued PO locally so it appears immediately in Inventory/Financials
      const reissuedPO: PurchaseOrder = {
        ...po,
        id: reissueData.newPo,
        poNumber: reissueData.newPo,
        originalPoId: contract.poId,
        originalPoNumber: po.poNumber,
        amount: reissuedAmount,
        status: 'Funded',
        visibility: 'Funded',
        isPublished: false,
        reservedBy: contract.investorId,
        reservationStatus: 'Completed',
        items: reissuedItems
      };
      await setDoc(doc(db, 'purchaseOrders', reissuedPO.id), reissuedPO, { merge: true })
        .catch(err => handleFirestoreError(err, 'write', `purchaseOrders/${reissuedPO.id}`));

      // 5. Create a new contract for the new PO
      const newContractId = `con-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
      const newContract: Contract = {
        id: newContractId,
        reservationId: reservation.id,
        poId: reissueData.newPo,
        originalPoId: contract.poId,
        investorId: contract.investorId,
        generatedDate: new Date().toISOString(),
        status: 'Sent',
        content: contract.content,
        unsignedDocumentUrl: contract.unsignedDocumentUrl
      };
      await setDoc(doc(db, 'contracts', newContractId), newContract)
        .catch(err => handleFirestoreError(err, 'write', `contracts/${newContractId}`));

      // 6. Update reservation to point to new PO
      await updateDoc(doc(db, 'reservations', reservation.id), {
        poId: reissueData.newPo,
        originalPoId: contract.poId
      }).catch(err => handleFirestoreError(err, 'write', `reservations/${reservation.id}`));

      alert(`Contract finalized. Original PO ${po.poNumber} canceled. New PO ${reissueData.newPo} created with ${reservation.paymentOption.interest}% markup. Press Sync to pull the new PO into the portal.`);
    } catch (error: any) {
      console.error('Finalize contract error:', error);
      alert(`Failed to finalize contract: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAcceptReservation = async (resId: string) => {
    const reservation = reservations.find(r => r.id === resId);
    if (reservation) {
      const po = pos.find(p => p.id === reservation.poId);
      const investor = investors.find(i => i.id === reservation.investorId);
      
      if (!po || !investor) {
        alert('Missing PO or Lender profile. Cannot accept reservation.');
        return;
      }

      setIsSubmitting(true);
      try {
        const contractId = `con-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
        const newContract: Contract = {
          id: contractId,
          reservationId: reservation.id,
          poId: reservation.poId,
          investorId: reservation.investorId,
          generatedDate: new Date().toISOString(),
          status: 'Draft',
          content: `MASTER CONSIGNMENT & SUPPLY AGREEMENT for PO ${po.poNumber}`,
          unsignedDocumentUrl: '#' // Will be generated on the fly or stored
        };
        
        // 1. Create contract
        await setDoc(doc(db, 'contracts', contractId), newContract)
          .catch(err => handleFirestoreError(err, 'write', `contracts/${contractId}`));

        // 2. Update reservation
        await updateDoc(doc(db, 'reservations', resId), { status: 'Accepted' })
          .catch(err => handleFirestoreError(err, 'write', `reservations/${resId}`));

        // 3. Reject all other pending reservations for the same PO
        const competingReservations = reservations.filter(
          r => r.poId === reservation.poId && r.id !== resId && r.status === 'Pending'
        );
        await Promise.all(
          competingReservations.map(r =>
            updateDoc(doc(db, 'reservations', r.id), { status: 'Rejected' })
              .catch(err => handleFirestoreError(err, 'write', `reservations/${r.id}`))
          )
        );

        // 4. Update PO
        await updateDoc(doc(db, 'purchaseOrders', reservation.poId), {
          reservationStatus: 'Accepted'
        }).catch(err => handleFirestoreError(err, 'write', `purchaseOrders/${reservation.poId}`));

        alert('Reservation accepted and contract generated.');
      } catch (error: any) {
        console.error('Accept reservation error:', error);
        alert('Failed to accept reservation.');
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const handleRejectReservation = async (resId: string) => {
    const reservation = reservations.find(r => r.id === resId);
    if (reservation) {
      try {
        await updateDoc(doc(db, 'reservations', resId), { status: 'Rejected' })
          .catch(err => handleFirestoreError(err, 'write', `reservations/${resId}`));
        
        const originalPo = pos.find(p => p.reissuedPoId === reservation.poId);
        const poIdToUpdate = originalPo ? originalPo.id : reservation.poId;
        
        await updateDoc(doc(db, 'purchaseOrders', poIdToUpdate), { 
          reservedBy: deleteField(), 
          reservationStatus: deleteField() 
        }).catch(err => handleFirestoreError(err, 'write', `purchaseOrders/${poIdToUpdate}`));
      } catch (error) {
        console.error('Error rejecting reservation:', error);
      }
    }
  };

  const handleUpdatePOVisibility = async (poId: string, visibility: string) => {
    try {
      await updateDoc(doc(db, 'purchaseOrders', poId), {
        visibility: visibility,
        isPublished: visibility === 'Published'
      }).catch(err => handleFirestoreError(err, 'write', `purchaseOrders/${poId}`));
    } catch (error) {
      console.error('Update visibility error:', error);
    }
  };

  const handleTogglePublish = async (poId: string) => {
    const po = pos.find(p => p.id === poId);
    if (!po) return;
    try {
      await updateDoc(doc(db, 'purchaseOrders', poId), {
        isPublished: !po.isPublished
      }).catch(err => handleFirestoreError(err, 'write', `purchaseOrders/${poId}`));
    } catch (error) {
      console.error('Toggle publish error:', error);
    }
  };

  const handleUpdateContractContent = (contractId: string, content: string) => {
    setContracts(prev => prev.map(c => c.id === contractId ? { ...c, content } : c));
    setEditingContractId(null);
  };

  const handleAddCapital = (amount: number) => {
    const newTx: BankTransaction = {
      id: `tx-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
      date: new Date().toISOString().split('T')[0],
      description: 'Capital Injection - Lender Deposit',
      amount: amount,
      type: 'Credit'
    };
    setTransactions(prev => [newTx, ...prev]);
    setCapitalModalOpen(false);
  };

  const handleUpdatePOStatus = (poId: string, status: POStatus) => {
    setPos(prev => prev.map(p => p.id === poId ? { ...p, status } : p));
  };

  const handleExecuteContract = (contractId: string) => {
    setContracts(prev => prev.map(c => c.id === contractId ? { 
      ...c, 
      status: 'Sent',
      docusignEnvelopeId: `DS-${Math.random().toString(36).substr(2, 8).toUpperCase()}`
    } : c));
  };

  const handleSyncDocuSign = async () => {
    // Simulate checking DocuSign for signatures
    const updatedContracts = contracts.map(c => {
      if (c.status === 'Sent') {
        return { 
          ...c, 
          status: 'Executed' as const, 
          signedAt: new Date().toISOString() 
        };
      }
      return c;
    });

    // Update Firestore for each executed contract
    for (const contract of updatedContracts) {
      if (contract.status === 'Executed' && contracts.find(c => c.id === contract.id)?.status === 'Sent') {
        await updateDoc(doc(db, 'contracts', contract.id), { 
          status: 'Executed',
          signedAt: contract.signedAt
        }).catch(err => handleFirestoreError(err, 'write', `contracts/${contract.id}`));
        
        const originalPo = pos.find(p => p.reissuedPoId === contract.poId);
        const poIdToUpdate = originalPo ? originalPo.id : contract.poId;
        
        // Move PO to Funded status
        await updateDoc(doc(db, 'purchaseOrders', poIdToUpdate), { 
          status: 'Funded'
        }).catch(err => handleFirestoreError(err, 'write', `purchaseOrders/${poIdToUpdate}`));
      }
    }
    
    setContracts(updatedContracts);
  };

  const handleRecordPayment = async (poId: string, amount: number) => {
    const po = pos.find(p => p.id === poId);
    const originalPo = pos.find(p => p.reissuedPoId === poId);
    const reservation = reservations.find(r => (r.poId === poId || (originalPo && r.poId === originalPo.id)) && r.status === 'Accepted');
    
    if (!po || !reservation) return;

    try {
      const totalPaidBefore = transactions
        .filter(tx => tx.linkedPoId === poId)
        .reduce((acc, tx) => acc + tx.amount, 0);

      const principal = reservation.amount;
      const interest = reservation.amount * (reservation.paymentOption.interest / 100);

      let principalPayment = 0;
      let interestPayment = 0;

      if (totalPaidBefore < principal) {
        principalPayment = Math.min(amount, principal - totalPaidBefore);
        interestPayment = amount - principalPayment;
      } else {
        interestPayment = amount;
      }

      if (principalPayment > 0) {
        const txIdP = `tx-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
        await setDoc(doc(db, 'transactions', txIdP), {
          id: txIdP,
          date: new Date().toISOString().split('T')[0],
          description: `Principal Repayment for ${po.poNumber}`,
          amount: principalPayment,
          type: 'Credit',
          linkedPoId: poId
        }).catch(err => handleFirestoreError(err, 'write', `transactions/${txIdP}`));
      }

      if (interestPayment > 0) {
        const txIdI = `tx-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
        await setDoc(doc(db, 'transactions', txIdI), {
          id: txIdI,
          date: new Date().toISOString().split('T')[0],
          description: `Interest Payment for ${po.poNumber}`,
          amount: interestPayment,
          type: 'Credit',
          linkedPoId: poId
        }).catch(err => handleFirestoreError(err, 'write', `transactions/${txIdI}`));
      }

      const totalPaid = totalPaidBefore + amount;
      const totalDue = principal + interest;

      if (totalPaid >= totalDue) {
        await updateDoc(doc(db, 'purchaseOrders', poId), { status: 'Completed' })
          .catch(err => handleFirestoreError(err, 'write', `purchaseOrders/${poId}`));
        
        await updateDoc(doc(db, 'reservations', reservation.id), { paymentStatus: 'Paid' })
          .catch(err => handleFirestoreError(err, 'write', `reservations/${reservation.id}`));
      }
      
      alert('Payment recorded successfully.');
    } catch (error) {
      console.error('Payment record error:', error);
      alert('Failed to record payment.');
    }
  };

  const handleSignContract = async (contractId: string, signedUrl?: string) => {
    const contract = contracts.find(c => c.id === contractId);
    if (!contract) return;

    const originalPo = pos.find(p => p.reissuedPoId === contract.poId);
    const po = pos.find(p => p.id === contract.poId || (originalPo && p.id === originalPo.id));
    const reservation = reservations.find(r => r.id === contract.reservationId || (originalPo && r.poId === originalPo.id));
    const investor = investors.find(i => i.id === contract.investorId);

    if (!po || !reservation || !investor) {
      alert('Missing data to sign contract.');
      return;
    }

    setIsSyncing(true);
    try {
      // Just update the contract status to Executed and save the URL
      await updateDoc(doc(db, 'contracts', contractId), {
        status: 'Executed',
        signedDocumentUrl: signedUrl || '#',
        signedAt: new Date().toISOString()
      }).catch(err => handleFirestoreError(err, 'write', `contracts/${contractId}`));

      alert('Contract signed and uploaded successfully.');
    } catch (error: any) {
      console.error('Error executing contract:', error);
      alert(`Failed to execute contract: ${error.message}`);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleReconcile = (txId: string) => {
    setReconciledTx(prev => [...prev, txId]);
  };

  const renderLoginPage = () => {
    return (
      <div className="min-h-screen flex flex-col bg-stone-50">
        {/* Branding Header */}
        <header className="px-12 py-8 flex items-center justify-between border-b border-stone-200 bg-white">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-ink rounded-2xl flex items-center justify-center text-white shadow-xl shadow-ink/20">
              <Package size={28} strokeWidth={1.5} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-ink uppercase leading-none">SVJ Logistics</h1>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-10">
          </div>
        </header>

        <div className="flex-1 flex items-center justify-center p-8 relative overflow-hidden">
          {/* Background Decorative Elements */}
          <div className="absolute top-0 left-0 w-full h-full opacity-[0.02] pointer-events-none">
            <div className="absolute top-20 left-20 w-[600px] h-[600px] bg-ink rounded-full blur-[120px]" />
            <div className="absolute bottom-20 right-20 w-[600px] h-[600px] bg-ink rounded-full blur-[120px]" />
          </div>

          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-lg bg-white border border-stone-200 p-12 rounded-[3rem] shadow-2xl shadow-stone-200/50 relative z-10"
          >
            <div className="mb-10">
              <h2 className="text-4xl font-semibold text-ink tracking-tight">
                {loginMode === 'login' ? 'Portal Access' : 'Vendor Registration'}
              </h2>
              <p className="text-zinc-500 text-base mt-3">
                {loginMode === 'login' 
                  ? 'Institutional Logistics Financing & Distribution' 
                  : 'Register your entity for distribution financing'}
              </p>
            </div>
            
            <div className="space-y-6">
              {loginMode === 'login' ? (
                <>
                  <form onSubmit={handleEmailLogin} className="space-y-5">
                    <div className="space-y-2">
                      <label className="mono-label ml-1 block">Email Address</label>
                      <div className="relative">
                        <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400" size={20} strokeWidth={1.5} />
                        <input 
                          type="email" 
                          value={emailInput}
                          onChange={(e) => setEmailInput(e.target.value)}
                          placeholder="name@company.com"
                          className="w-full bg-stone-50 border border-stone-200 rounded-[1.25rem] py-4 pl-14 pr-5 text-sm focus:outline-none focus:ring-4 focus:ring-ink/5 focus:border-ink transition-all input-with-icon"
                          required
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="mono-label ml-1 block">Password</label>
                      <div className="relative">
                        <ShieldCheck className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400" size={20} strokeWidth={1.5} />
                        <input 
                          type="password" 
                          value={passwordInput}
                          onChange={(e) => setPasswordInput(e.target.value)}
                          placeholder="••••••••"
                          className="w-full bg-stone-50 border border-stone-200 rounded-[1.25rem] py-4 pl-14 pr-5 text-sm focus:outline-none focus:ring-4 focus:ring-ink/5 focus:border-ink transition-all input-with-icon"
                          required
                        />
                      </div>
                    </div>
                    <div className="flex justify-center">
                      <button 
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full max-w-xs bg-ink text-white py-4 rounded-[1.25rem] font-bold text-xs tracking-widest uppercase hover:bg-zinc-800 transition-all flex items-center justify-center gap-3 group shadow-xl shadow-ink/10 active:scale-[0.98] disabled:opacity-50"
                      >
                        {isSubmitting ? 'Authenticating...' : 'Sign In'} <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                      </button>
                    </div>
                  </form>

                  <div className="relative flex items-center justify-center py-2">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-stone-100"></div>
                    </div>
                    <span className="relative px-4 bg-white text-[10px] font-mono text-stone-400 uppercase tracking-widest">or</span>
                  </div>

                  <div className="flex justify-center">
                    <button 
                      onClick={handleLogin}
                      className="w-full max-w-xs bg-white border-2 border-stone-100 text-ink py-4 rounded-[1.25rem] font-bold text-xs tracking-widest uppercase hover:bg-stone-50 transition-all flex items-center justify-center gap-4 group shadow-sm active:scale-[0.98]"
                    >
                      <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" referrerPolicy="no-referrer" />
                      Sign in with Google
                    </button>
                  </div>

                  <p className="text-center text-xs text-zinc-400 font-mono mt-6">
                    New vendor? <button onClick={() => setLoginMode('signup')} className="text-ink font-bold hover:underline">Register Entity</button>
                  </p>
                </>
              ) : (
                <form onSubmit={handleSignup} className="space-y-5">
                  <div className="space-y-2">
                    <label className="mono-label ml-1 block">Entity Legal Name (Vendor)</label>
                    <div className="relative">
                      <Package className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400" size={20} strokeWidth={1.5} />
                      <input 
                        type="text" 
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        placeholder="Acme Corp LLC"
                        className="w-full bg-stone-50 border border-stone-200 rounded-[1.25rem] py-4 pl-14 pr-5 text-sm focus:outline-none focus:ring-4 focus:ring-ink/5 focus:border-ink transition-all input-with-icon"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="mono-label ml-1 block">Contact Person Name</label>
                    <div className="relative">
                      <Users className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400" size={20} strokeWidth={1.5} />
                      <input 
                        type="text" 
                        value={contactNameInput}
                        onChange={(e) => setContactNameInput(e.target.value)}
                        placeholder="John Doe"
                        className="w-full bg-stone-50 border border-stone-200 rounded-[1.25rem] py-4 pl-14 pr-5 text-sm focus:outline-none focus:ring-4 focus:ring-ink/5 focus:border-ink transition-all input-with-icon"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="mono-label ml-1 block">Entity Physical Address</label>
                    <div className="relative">
                      <MapPin className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400" size={20} strokeWidth={1.5} />
                      <input 
                        type="text" 
                        value={addressInput}
                        onChange={(e) => setAddressInput(e.target.value)}
                        placeholder="123 Business Way, Suite 100"
                        className="w-full bg-stone-50 border border-stone-200 rounded-[1.25rem] py-4 pl-14 pr-5 text-sm focus:outline-none focus:ring-4 focus:ring-ink/5 focus:border-ink transition-all input-with-icon"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="mono-label ml-1 block">Corporate Email</label>
                    <div className="relative">
                      <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400" size={20} strokeWidth={1.5} />
                      <input 
                        type="email" 
                        value={emailInput}
                        onChange={(e) => setEmailInput(e.target.value)}
                        placeholder="finance@acme.com"
                        className="w-full bg-stone-50 border border-stone-200 rounded-[1.25rem] py-4 pl-14 pr-5 text-sm focus:outline-none focus:ring-4 focus:ring-ink/5 focus:border-ink transition-all input-with-icon"
                        required
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="mono-label ml-1 block">Security Password</label>
                    <div className="relative">
                      <ShieldCheck className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400" size={20} strokeWidth={1.5} />
                      <input 
                        type="password" 
                        value={passwordInput}
                        onChange={(e) => setPasswordInput(e.target.value)}
                        placeholder="••••••••"
                        className="w-full bg-stone-50 border border-stone-200 rounded-[1.25rem] py-4 pl-14 pr-5 text-sm focus:outline-none focus:ring-4 focus:ring-ink/5 focus:border-ink transition-all input-with-icon"
                        required
                      />
                    </div>
                  </div>
                  <div className="flex justify-center">
                    <button 
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full max-w-xs bg-ink text-white py-4 rounded-[1.25rem] font-bold text-xs tracking-widest uppercase hover:bg-zinc-800 transition-all flex items-center justify-center gap-3 group shadow-xl shadow-ink/10 active:scale-[0.98] disabled:opacity-50"
                    >
                      {isSubmitting ? 'Processing Registration...' : 'Register & Create Account'} <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </button>
                  </div>
                  <p className="text-center text-xs text-zinc-400 font-mono mt-4">
                    Already registered? <button type="button" onClick={() => setLoginMode('login')} className="text-ink font-bold hover:underline">Sign In</button>
                  </p>
                </form>
              )}
            </div>
          </motion.div>
        </div>

        {/* Footer */}
        <footer className="px-12 py-10 border-t border-stone-200 bg-white flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="mono-label">
            © 2026 SVJ Logistics
          </div>
          <div className="flex gap-10 mono-label">
          </div>
        </footer>
      </div>
    );
  };

  const renderLenderPortal = () => {
    return (
      <div className="min-h-screen bg-stone-50/50 flex flex-col overflow-x-hidden">
        <div className="max-w-[1600px] mx-auto w-full px-6 md:px-12 py-10 md:py-20 flex-grow space-y-12 md:space-y-16">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-8">
            <div>
              <p className="mono-label mb-4">Lender Terminal</p>
              <h1 className="display-text text-3xl md:text-4xl">Portfolio <span className="italic font-serif">Overview</span></h1>
            </div>
            <div className="flex flex-wrap gap-8 md:gap-16 items-end">
              <div className="flex gap-6 md:gap-10 mb-2 border-b border-stone-200/60">
                {[
                  { id: 'marketplace', label: 'Marketplace' },
                  { id: 'portfolio', label: 'My Portfolio' },
                  { id: 'profile', label: 'Profile' }
                ].map((tab) => (
                  <button 
                    key={tab.id}
                    onClick={() => {
                      setLenderTab(tab.id as any);
                      if (tab.id === 'profile' && currentLender) {
                        setNameInput(currentLender.name);
                        setContactNameInput(currentLender.contactName || '');
                        setAddressInput(currentLender.address || '');
                        setEmailInput(currentLender.email);
                      }
                    }}
                    className={`pb-4 text-[11px] font-mono uppercase tracking-[0.2em] transition-all relative ${
                      lenderTab === tab.id 
                        ? 'text-ink font-bold' 
                        : 'text-stone-400 hover:text-stone-600'
                    }`}
                  >
                    {tab.label}
                    {lenderTab === tab.id && (
                      <motion.div 
                        layoutId="lenderTabUnderline"
                        className="absolute bottom-0 left-0 right-0 h-0.5 bg-ink"
                      />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

      <div className="horizontal-divider" />

      {lenderTab === 'marketplace' ? (

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-16">
        <div className="lg:col-span-2 space-y-10">
          <div className="flex justify-between items-center">
            <h3 className="mono-label">Available Purchase Orders</h3>
            <div className="flex gap-4">
              <div className="flex items-center gap-3 bg-white border border-stone-200 px-5 py-2.5 rounded-full shadow-sm">
                <Search size={16} className="text-zinc-400" strokeWidth={1.5} />
                <input 
                  type="text" 
                  placeholder="Filter by Vendor or PO..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="text-xs bg-transparent border-none focus:ring-0 w-48 placeholder:text-zinc-300" 
                />
              </div>
            </div>
          </div>

          <div className="premium-card">
            <div className="grid grid-cols-4 premium-table-header">
              <span className="mono-label !text-zinc-500">PO Details</span>
              <span className="mono-label !text-zinc-500">Status</span>
              <span className="mono-label !text-zinc-500">Yield</span>
              <span className="mono-label !text-zinc-500 text-right">Amount</span>
            </div>
            <div className="divide-y divide-stone-100">
              {pos.filter(po => 
                po.isPublished && 
                po.visibility !== 'Funded' && 
                po.visibility !== 'Funded(Original)' &&
                (po.status === 'To be Shipped' || po.reservedBy) &&
                (po.vendorName?.toLowerCase().includes(searchTerm.toLowerCase()) || po.vendor.toLowerCase().includes(searchTerm.toLowerCase()) || po.poNumber.toLowerCase().includes(searchTerm.toLowerCase()))
              ).map(po => {
                const reservation = reservations.find(r => r.poId === po.id && r.status !== 'Rejected');
                const isReservedByMe = reservation?.investorId === currentLender?.id;
                const isReservedByOther = reservation && !isReservedByMe;

                return (
                  <motion.div 
                    key={po.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="grid grid-cols-4 premium-table-row items-center cursor-pointer group hover:bg-stone-50"
                    onClick={() => {
                      setSelectedPO(po);
                      setReservationAmount(po.amount);
                    }}
                  >
                    <div className="space-y-1.5">
                      <p className="mono-label !text-zinc-400">{po.poNumber}</p>
                      <p className="text-base font-bold tracking-tight text-ink">{po.vendorName || po.vendor}</p>
                    </div>
                    <div>
                      <span className={`status-pill ${isReservedByMe ? 'status-emerald' : isReservedByOther ? 'status-amber' : 'status-zinc'}`}>
                        {po.status === 'To be Shipped' ? (reservation ? 'RESERVED' : 'OPEN') : 'RESERVED'}
                      </span>
                    </div>
                    <div className="mono-value text-emerald-600 font-bold">
                      {reservation ? `+${reservation.paymentOption.interest}%` : 'Up to 10%'}
                    </div>
                    <div className="text-right mono-value text-xl font-medium">
                      ${po.amount.toLocaleString()}
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="space-y-10">
          <div className="bg-ink text-white p-12 rounded-[3rem] shadow-2xl relative overflow-hidden">
            <div className="relative z-10 space-y-10">
              <p className="mono-label !text-white/50">Portfolio Health</p>
              <div className="space-y-3">
                <p className="text-6xl font-light tracking-tighter text-emerald-400">
                  {(() => {
                    const myReservations = reservations.filter(r => r.investorId === currentLender?.id);
                    if (myReservations.length === 0) return '0.0%';
                    const avg = myReservations.reduce((acc, r) => acc + r.paymentOption.interest, 0) / myReservations.length;
                    return `${avg.toFixed(1)}%`;
                  })()}
                </p>
                <p className="mono-label !text-white/50">Avg. Annual Yield</p>
              </div>
              <div className="h-px bg-white/10 w-full" />
              <div className="flex justify-between items-end">
                <div>
                  <p className="text-3xl font-light tracking-tighter">{reservations.filter(r => r.investorId === currentLender?.id && r.status === 'Pending').length}</p>
                  <p className="mono-label !text-white/50">Active Bids</p>
                </div>
              </div>
            </div>
            <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-emerald-500/10 rounded-full blur-[100px]" />
          </div>

          <div className="premium-card p-10">
            <h3 className="mono-label mb-10">Pending Reservations</h3>
            <div className="space-y-10">
              {reservations.filter(r => r.investorId === currentLender?.id && r.status === 'Pending').map(res => {
                const po = pos.find(p => p.id === res.poId);
                
                return (
                  <div key={res.id} className="space-y-5">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-base font-bold text-ink tracking-tight">PO-{po?.poNumber || res.poId}</p>
                        <p className="mono-label mt-1.5">{po?.vendor || 'N/A'}</p>
                      </div>
                      <span className="status-pill status-amber">
                        PENDING
                      </span>
                    </div>
                    <div className="flex justify-between items-end">
                      <p className="mono-value text-xl font-medium">${res.amount.toLocaleString()}</p>
                      <p className="text-[10px] font-mono text-zinc-400 italic">Underwriting</p>
                    </div>
                    <div className="h-px bg-stone-100" />
                  </div>
                );
              })}
              {reservations.filter(r => r.investorId === currentLender?.id && r.status === 'Pending').length === 0 && (
                <div className="text-center py-10">
                  <p className="text-xs text-zinc-400 font-mono italic">No active reservations</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    ) : (
      <div className="space-y-16">
        {lenderTab === 'portfolio' && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-10">
          <div className="premium-card p-10 bg-ink text-white">
            <p className="mono-label !text-white/50 mb-6">Total Financed</p>
            <p className="text-5xl font-light tracking-tighter text-emerald-400">
              ${reservations.filter(r => r.investorId === currentLender?.id && r.status === 'Accepted').reduce((acc, r) => acc + r.amount, 0).toLocaleString()}
            </p>
          </div>
          <div className="premium-card p-10">
            <p className="mono-label mb-6">Yield Earned</p>
            <p className="text-5xl font-light tracking-tighter text-ink">
              ${transactions.filter(tx => {
                const po = pos.find(p => p.id === tx.linkedPoId);
                const originalPo = pos.find(p => p.reissuedPoId === tx.linkedPoId);
                const reservation = reservations.find(r => (r.poId === tx.linkedPoId || (originalPo && r.poId === originalPo.id)) && r.status === 'Accepted');
                return reservation?.investorId === currentLender?.id && tx.description.includes('Interest');
              }).reduce((acc, tx) => acc + tx.amount, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </p>
          </div>
          <div className="premium-card p-10">
            <p className="mono-label mb-6">Active Contracts</p>
            <p className="text-5xl font-light tracking-tighter text-ink">
              {contracts.filter(c => c.investorId === currentLender?.id && c.status === 'Executed').length}
            </p>
          </div>
        </div>

        <div className="premium-card">
          <div className="p-10 border-b border-stone-100 bg-stone-50/30">
            <h3 className="mono-label">Active Portfolio Assets</h3>
          </div>
          <div className="grid grid-cols-6 premium-table-header">
            <div className="mono-label col-span-2 !text-zinc-500 cursor-pointer hover:bg-stone-100 transition-colors px-4 py-2 flex items-center gap-2" onClick={() => handleSort('poNumber')}>
              Financed Asset
              {sortConfig.key === 'poNumber' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : null)}
            </div>
            <div className="mono-label !text-zinc-500 cursor-pointer hover:bg-stone-100 transition-colors px-4 py-2 flex items-center gap-2" onClick={() => handleSort('status')}>
              PO Status
              {sortConfig.key === 'status' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : null)}
            </div>
            <div className="mono-label !text-zinc-500 cursor-pointer hover:bg-stone-100 transition-colors px-4 py-2 flex items-center gap-2" onClick={() => handleSort('amount')}>
              Financials
              {sortConfig.key === 'amount' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : null)}
            </div>
            <div className="mono-label !text-zinc-500 px-4 py-2">Legal</div>
            <div className="mono-label !text-zinc-500 text-right px-4 py-2">Repayment</div>
          </div>
          <div className="divide-y divide-stone-100">
            {getSortedData(reservations
              .filter(r => r.investorId === currentLender?.id && r.status === 'Accepted')
              .filter(res => {
                let po = pos.find(p => p.id === res.poId);
                if (po?.visibility === 'Funded(Original)' && po.reissuedPoId) {
                  po = pos.find(p => p.id === po?.reissuedPoId) || po;
                }
                return po?.visibility !== 'Funded(Original)';
              }))
              .map(res => {
                let po = pos.find(p => p.id === res.poId);
                if (po?.visibility === 'Funded(Original)' && po.reissuedPoId) {
                  po = pos.find(p => p.id === po?.reissuedPoId) || po;
                }
                const contract = contracts.find(c => c.reservationId === res.id);
              const interest = res.amount * (res.paymentOption.interest / 100);
              const total = res.amount + interest;
              
              const totalRepaid = transactions
                .filter(t => t.linkedPoId === po?.id)
                .reduce((acc, t) => acc + t.amount, 0);
              const isPaid = totalRepaid >= total;
              
              return (
                <div 
                  key={res.id} 
                  className="grid grid-cols-6 px-8 py-10 items-center hover:bg-stone-50 transition-colors cursor-pointer group"
                  onClick={() => {
                    if (po) {
                      setSelectedPO(po);
                      setReservationAmount(po.amount);
                    }
                  }}
                >
                  <div className="col-span-2 space-y-1.5">
                    <p className="mono-label !text-zinc-400">PO-{po?.poNumber}</p>
                    <p className="text-lg font-bold text-ink tracking-tight">{po?.vendor}</p>
                    <p className="text-xs text-zinc-400 font-mono uppercase tracking-wider">{po?.location}</p>
                  </div>
                  <div>
                    <span className={`status-pill ${isPaid ? 'status-emerald' : 'status-zinc'}`}>
                      {isPaid ? 'PAID' : po?.status?.toUpperCase()}
                    </span>
                  </div>
                  <div className="space-y-2">
                    <p className="text-[11px] font-mono text-zinc-400">Principal: <span className="text-ink font-bold">${res.amount.toLocaleString()}</span></p>
                    <p className="text-[11px] font-mono text-emerald-600">Interest: <span className="font-bold">${interest.toLocaleString()}</span></p>
                  </div>
                  <div className="space-y-3">
                    <p className="mono-label !text-zinc-400">
                      {contract?.status === 'Executed' ? 'Executed' : contract?.status === 'Signed' ? 'Funded' : contract?.status === 'Sent' ? 'Awaiting Sign' : 'Drafting'}
                    </p>
                    {contract?.status === 'Executed' && (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (contract.signedDocumentUrl) window.open(contract.signedDocumentUrl, '_blank');
                          else alert('Signed document not available yet.');
                        }}
                        className="text-[10px] font-bold text-ink underline underline-offset-8 hover:text-zinc-500 transition-all uppercase tracking-widest"
                      >
                        View Agreement
                      </button>
                    )}
                  </div>
                  <div className="text-right space-y-2">
                    <p className="text-2xl font-light tracking-tighter text-ink">${total.toLocaleString()}</p>
                    <span className={`status-pill ${res.paymentStatus === 'Paid' ? 'status-emerald' : 'status-amber'}`}>
                      {res.paymentStatus === 'Paid' ? 'RECONCILED' : 'PENDING'}
                    </span>
                  </div>
                </div>
              );
            })}
            {reservations.filter(r => r.investorId === currentLender?.id && r.status === 'Accepted').length === 0 && (
              <div className="text-center py-20">
                <p className="text-sm text-zinc-400 font-mono italic">No active portfolio assets</p>
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-10">
          {/* Payments Section */}
          <div className="premium-card p-10 space-y-8">
            <div className="flex justify-between items-center">
              <h3 className="mono-label">Payment History</h3>
              <CreditCard size={18} className="text-zinc-400" />
            </div>
            <div className="space-y-6">
              {transactions.filter(tx => {
                const po = pos.find(p => p.id === tx.linkedPoId);
                const originalPo = pos.find(p => p.reissuedPoId === tx.linkedPoId);
                const reservation = reservations.find(r => (r.poId === tx.linkedPoId || (originalPo && r.poId === originalPo.id)) && r.status === 'Accepted');
                return reservation?.investorId === currentLender?.id;
              }).map(tx => (
                <div key={tx.id} className="flex justify-between items-center p-6 bg-stone-50 rounded-2xl border border-stone-100">
                  <div className="space-y-1">
                    <p className="text-sm font-bold text-ink">{tx.description}</p>
                    <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">{tx.date}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${tx.type === 'Credit' ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {tx.type === 'Credit' ? '+' : '-'}${tx.amount.toLocaleString()}
                    </p>
                    <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">{tx.type}</p>
                  </div>
                </div>
              ))}
              {transactions.filter(tx => {
                const po = pos.find(p => p.id === tx.linkedPoId);
                const originalPo = pos.find(p => p.reissuedPoId === tx.linkedPoId);
                const reservation = reservations.find(r => (r.poId === tx.linkedPoId || (originalPo && r.poId === originalPo.id)) && r.status === 'Accepted');
                return reservation?.investorId === currentLender?.id;
              }).length === 0 && (
                <p className="text-center py-10 text-xs text-zinc-400 font-mono italic">No payments recorded yet</p>
              )}
            </div>
          </div>
        </div>
          </>
        )}
            {lenderTab === 'profile' && currentLender && (
              <div className="max-w-2xl mx-auto">
                <div className="premium-card p-12">
                  <div className="flex items-center gap-8 mb-12">
                    <div className="w-24 h-24 bg-stone-50 rounded-[2rem] flex items-center justify-center text-ink border border-stone-100">
                      <Users size={40} strokeWidth={1.5} />
                    </div>
                    <div>
                      <h3 className="text-3xl font-bold text-ink tracking-tight">{currentLender.name}</h3>
                      <p className="text-zinc-500 font-medium text-lg">{currentLender.contactName || 'No contact person set'}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">Acumatica Vendor ID: {currentLender.vendorId || 'Not Synced'}</p>
                      </div>
                    </div>
                  </div>

                  <form onSubmit={handleUpdateProfile} className="space-y-8">
                    <div className="grid grid-cols-1 gap-8">
                      <div className="space-y-3">
                        <label className="mono-label ml-1">Vendor Name (Company)</label>
                        <div className="relative group">
                          <Package className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-ink transition-colors" size={20} strokeWidth={1.5} />
                          <input 
                            type="text" 
                            className="w-full bg-stone-50 border-stone-200 rounded-2xl py-4 pl-14 pr-6 focus:ring-4 focus:ring-ink/5 focus:border-ink transition-all text-sm font-medium input-with-icon"
                            value={nameInput}
                            onChange={(e) => setNameInput(e.target.value)}
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-3">
                        <label className="mono-label ml-1">Contact Person Name</label>
                        <div className="relative group">
                          <Users className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-ink transition-colors" size={20} strokeWidth={1.5} />
                          <input 
                            type="text" 
                            className="w-full bg-stone-50 border-stone-200 rounded-2xl py-4 pl-14 pr-6 focus:ring-4 focus:ring-ink/5 focus:border-ink transition-all text-sm font-medium input-with-icon"
                            value={contactNameInput}
                            onChange={(e) => setContactNameInput(e.target.value)}
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-3">
                        <label className="mono-label ml-1">Physical Address</label>
                        <div className="relative group">
                          <MapPin className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-ink transition-colors" size={20} strokeWidth={1.5} />
                          <input 
                            type="text" 
                            className="w-full bg-stone-50 border-stone-200 rounded-2xl py-4 pl-14 pr-6 focus:ring-4 focus:ring-ink/5 focus:border-ink transition-all text-sm font-medium input-with-icon"
                            value={addressInput}
                            onChange={(e) => setAddressInput(e.target.value)}
                            required
                          />
                        </div>
                      </div>

                      <div className="space-y-3">
                        <label className="mono-label ml-1">Email Address</label>
                        <div className="relative group">
                          <Mail className="absolute left-5 top-1/2 -translate-y-1/2 text-zinc-400 group-focus-within:text-ink transition-colors" size={20} strokeWidth={1.5} />
                          <input 
                            type="email" 
                            className="w-full bg-stone-50 border-stone-200 rounded-2xl py-4 pl-14 pr-6 focus:ring-4 focus:ring-ink/5 focus:border-ink transition-all text-sm font-medium input-with-icon"
                            value={emailInput}
                            onChange={(e) => setEmailInput(e.target.value)}
                            required
                          />
                        </div>
                      </div>
                    </div>

                    <div className="pt-6">
                      <button 
                        type="submit" 
                        disabled={isSubmitting}
                        className="w-full bg-ink text-white py-6 rounded-2xl font-bold text-xs tracking-widest uppercase hover:bg-zinc-800 transition-all flex items-center justify-center gap-4 group shadow-2xl shadow-ink/20 active:scale-[0.98] disabled:opacity-50"
                      >
                        {isSubmitting ? (
                          <RefreshCw className="animate-spin" size={20} />
                        ) : (
                          <>
                            <ShieldCheck size={20} />
                            <span>Update & Sync with Acumatica</span>
                          </>
                        )}
                      </button>
                    </div>
                  </form>

                  {/* Debug Info */}
                  <div className="mt-12 pt-10 border-t border-stone-100">
                    <h3 className="text-[10px] font-mono font-bold text-stone-400 mb-6 uppercase tracking-[0.2em]">System Diagnostics</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-stone-50 p-6 rounded-2xl border border-stone-100 font-mono text-[10px] space-y-2">
                        <p className="flex justify-between"><span className="text-stone-400">UID:</span> <span className="text-ink font-bold">{(user as any).uid}</span></p>
                        <p className="flex justify-between"><span className="text-stone-400">Role:</span> <span className="text-ink font-bold">{user.role}</span></p>
                      </div>
                      <div className="bg-stone-50 p-6 rounded-2xl border border-stone-100 font-mono text-[10px] space-y-2">
                        <p className="flex justify-between"><span className="text-stone-400">Lender Profile:</span> <span className={currentLender ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>{currentLender ? 'Active' : 'Missing'}</span></p>
                        <p className="flex justify-between"><span className="text-stone-400">View Mode:</span> <span className="text-ink font-bold">{viewMode}</span></p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

  const renderAdminPortal = () => {
    return (
      <div className="min-h-screen bg-stone-50/50 flex flex-col overflow-x-hidden">
        <div className="max-w-[1600px] mx-auto w-full px-6 md:px-12 py-10 md:py-20 flex-grow space-y-12 md:space-y-16">
          {/* Header Section */}
          <div className="premium-card p-6 md:p-10">
            <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-8">
              <div className="flex-grow">
                <div className="mono-label mb-3 flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  System Administrator • Active Session
                </div>
                <h2 className="display-text text-4xl">Operations Control</h2>
                
                <div className="flex gap-8 mt-8 border-b border-stone-200/60">
                  {[
                    { id: 'inventory', label: 'Inventory', count: null },
                    { id: 'reservations', label: 'Reservations', count: reservations.filter(r => r.status === 'Pending').length },
                    { id: 'legal', label: 'Legal', count: null },
                    { id: 'finance', label: 'Financials', count: null }
                  ].map((tab) => (
                    <button 
                      key={tab.id}
                      onClick={() => setAdminSubTab(tab.id as any)}
                      className={`pb-4 text-[11px] font-mono uppercase tracking-[0.2em] transition-all relative ${
                        adminSubTab === tab.id 
                          ? 'text-ink font-bold' 
                          : 'text-stone-400 hover:text-stone-600'
                      }`}
                    >
                      {tab.label} {tab.count !== null && tab.count > 0 && `(${tab.count})`}
                      {adminSubTab === tab.id && (
                        <motion.div 
                          layoutId="adminTabUnderline"
                          className="absolute bottom-0 left-0 right-0 h-0.5 bg-ink"
                        />
                      )}
                    </button>
                  ))}
                </div>
              </div>
              
              <div className="flex flex-wrap items-center gap-4 md:gap-6">
                {lastSyncTime && (
                  <div className="flex flex-col items-start md:items-end gap-1">
                    <p className="text-[9px] font-mono text-stone-400 uppercase tracking-[0.2em]">Last System Sync</p>
                    <p className={`text-[11px] font-mono font-bold tracking-wider ${
                      (() => {
                        const syncDate = new Date(lastSyncTime);
                        const today = new Date();
                        return syncDate.toDateString() === today.toDateString();
                      })() ? 'text-emerald-500' : 'text-stone-500'
                    }`}>
                      {new Date(lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} 
                      <span className="ml-2 opacity-60 font-normal">
                        {new Date(lastSyncTime).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      </span>
                    </p>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-4">
                  <button 
                    onClick={handleAcumaticaSync}
                    disabled={isSyncing}
                    className="flex items-center gap-2 px-4 md:px-6 py-2.5 md:py-3 rounded-xl text-[10px] md:text-[11px] font-bold tracking-widest uppercase transition-all shadow-lg bg-ink text-white hover:bg-zinc-800 shadow-zinc-500/20 whitespace-nowrap"
                  >
                    <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
                    {isSyncing ? 'Syncing...' : 'Sync Acumatica'}
                  </button>
                  <div className="bg-stone-100/50 border border-stone-200/60 px-4 md:px-8 py-3 md:py-5 rounded-2xl text-left md:text-right min-w-[180px]">
                    <p className="mono-label !text-[9px] mb-1">Total AUM ({adminSubTab.charAt(0).toUpperCase() + adminSubTab.slice(1)})</p>
                    <p className="text-xl md:text-2xl font-bold text-ink tracking-tight">${calculateAUM()}</p>
                  </div>
                </div>
              </div>
          </div>
        </div>

      {adminSubTab === 'inventory' && (
        <div className="max-w-7xl mx-auto w-full px-12 mb-6 flex justify-end relative">
          <button
            onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[9px] font-mono uppercase tracking-widest border border-stone-200 text-stone-600 hover:bg-stone-50 transition-all bg-white shadow-sm"
          >
            <Filter size={10} />
            Visibility
            <ChevronDown size={10} className={`transition-transform ${filterDropdownOpen ? 'rotate-180' : ''}`} />
          </button>
          
          {filterDropdownOpen && (
            <div className="absolute top-full right-0 mt-1 w-28 bg-white border border-stone-200 rounded-lg shadow-lg z-50 p-0.5">
              {['All', 'Published', 'Hidden', 'Funded(Original)', 'Funded'].map(v => (
                <label key={v} className="flex items-center gap-1 px-1.5 py-0.5 hover:bg-stone-50 rounded cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={v === 'All' ? visibilityFilter.length === 4 : visibilityFilter.includes(v)}
                    onChange={() => {
                      if (v === 'All') {
                        setVisibilityFilter(visibilityFilter.length === 4 ? [] : ['Published', 'Hidden', 'Funded(Original)', 'Funded']);
                      } else {
                        if (visibilityFilter.includes(v)) {
                          setVisibilityFilter(visibilityFilter.filter(f => f !== v));
                        } else {
                          setVisibilityFilter([...visibilityFilter, v]);
                        }
                      }
                    }}
                    className="w-2 h-2 rounded-sm border-stone-300 text-ink focus:ring-ink"
                  />
                  <span className="text-[7px] font-mono uppercase tracking-wider text-stone-600 group-hover:text-ink truncate">{v}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}

      <AnimatePresence mode="wait">
          <motion.div
            key={adminSubTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }}
          >
            {adminSubTab === 'inventory' && (
              <div className="space-y-6">
                <div className="premium-card overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[1200px]">
                    <thead>
                      <tr className="premium-table-header">
                        <th className="px-6 py-4 cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('poNumber')}>
                          <div className="flex items-center gap-2">
                            PO Details
                            {sortConfig.key === 'poNumber' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : null)}
                          </div>
                        </th>
                        <th className="px-6 py-4 cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('status')}>
                          <div className="flex items-center gap-2">
                            Status
                            {sortConfig.key === 'status' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : null)}
                          </div>
                        </th>
                        <th className="px-6 py-4 text-right cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('amount')}>
                          <div className="flex items-center justify-end gap-2">
                            Amount
                            {sortConfig.key === 'amount' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : null)}
                          </div>
                        </th>
                        <th className="px-6 py-4 text-right cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('orderQty')}>
                          <div className="flex items-center justify-end gap-2">
                            Order Qty
                            {sortConfig.key === 'orderQty' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : null)}
                          </div>
                        </th>
                        <th className="px-6 py-4 text-right cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('openQty')}>
                          <div className="flex items-center justify-end gap-2">
                            Open Qty
                            {sortConfig.key === 'openQty' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : null)}
                          </div>
                        </th>
                        <th className="px-6 py-4 cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('visibility')}>
                          <div className="flex items-center gap-2">
                            Visibility
                            {sortConfig.key === 'visibility' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : null)}
                          </div>
                        </th>
                        <th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {getSortedData(pos.filter(p => {
                        const visibility = p.visibility || 'None';
                        return visibilityFilter.includes(visibility);
                      })).map(po => (
                        <tr 
                          key={po.id} 
                          className="premium-table-row cursor-pointer hover:bg-stone-50 transition-colors group"
                          onClick={() => {
                            setSelectedPO(po);
                            setReservationAmount(po.amount);
                          }}
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-4">
                              <span className="mono-value bg-stone-100 px-2 py-0.5 rounded text-[10px] text-stone-600 border border-stone-200/50">{po.poNumber}</span>
                              <div>
                                <p className="text-xs font-bold text-ink group-hover:text-ink transition-colors">{po.vendorName || po.vendor}</p>
                                <p className="text-[10px] text-stone-400 mt-0.5 truncate max-w-[200px]">{po.description}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                            <select 
                              value={po.status}
                              onChange={(e) => handleUpdatePOStatus(po.id, e.target.value as any)}
                              className="text-[9px] font-mono uppercase tracking-wider bg-stone-50 border border-stone-200 rounded-lg px-1.5 py-0.5 focus:ring-1 focus:ring-ink focus:border-ink outline-none transition-all cursor-pointer h-7"
                            >
                              <option value="To be Shipped">To be Shipped</option>
                              <option value="Shipped">Shipped</option>
                              <option value="Landed">Landed</option>
                            </select>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="text-xs font-bold text-ink tabular-nums">${po.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="text-xs text-stone-600 tabular-nums">{po.orderQty?.toLocaleString() || 0}</span>
                          </td>
                          <td className="px-6 py-4 text-right">
                            <span className="text-xs text-stone-600 tabular-nums">{po.openQty?.toLocaleString() || 0}</span>
                          </td>
                          <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                            <select 
                              value={po.visibility || 'Hidden'}
                              onChange={(e) => handleUpdatePOVisibility(po.id, e.target.value)}
                              className="text-[9px] font-mono uppercase tracking-wider bg-stone-50 border border-stone-200 rounded-lg px-1.5 py-0.5 focus:ring-1 focus:ring-ink focus:border-ink outline-none transition-all cursor-pointer h-7"
                            >
                              <option value="Published">Published</option>
                              <option value="Hidden">Hidden</option>
                              <option value="Funded(Original)" disabled className="text-stone-400">Funded(Original)</option>
                              <option value="Funded" disabled className="text-stone-400">Funded</option>
                            </select>
                          </td>
                          <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={async (e) => {
                                  e.stopPropagation();
                                  if (confirm(`Permanently delete PO ${po.poNumber}? This cannot be undone.`)) {
                                    try {
                                      await deleteDoc(doc(db, 'purchaseOrders', po.id));
                                    } catch (err) {
                                      console.error('Error deleting PO:', err);
                                      alert('Failed to delete PO.');
                                    }
                                  }
                                }}
                                className="text-stone-300 hover:text-rose-500 transition-colors p-1.5 hover:bg-rose-50 rounded-full"
                                title="Delete PO"
                              >
                                <Trash2 size={14} />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); setSelectedPO(po); setReservationAmount(po.amount); }}
                                className="text-stone-300 hover:text-ink transition-colors p-1.5 hover:bg-stone-50 rounded-full"
                              >
                                <ChevronRight size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {adminSubTab === 'reservations' && (
              <div className="space-y-6">
                <div className="premium-card overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="premium-table-header">
                        <th className="px-10 py-6 cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('investorId')}>
                          <div className="flex items-center gap-2">
                            Lender Profile
                            {sortConfig.key === 'investorId' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : null)}
                          </div>
                        </th>
                        <th className="px-10 py-6 cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('poId')}>
                          <div className="flex items-center gap-2">
                            PO Reference
                            {sortConfig.key === 'poId' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : null)}
                          </div>
                        </th>
                        <th className="px-10 py-6 text-right cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('amount')}>
                          <div className="flex items-center justify-end gap-2">
                            Amount
                            {sortConfig.key === 'amount' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : null)}
                          </div>
                        </th>
                        <th className="px-10 py-6 cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('paymentOption.label')}>
                          <div className="flex items-center gap-2">
                            Terms
                            {sortConfig.key === 'paymentOption.label' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : null)}
                          </div>
                        </th>
                        <th className="px-10 py-6 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {getSortedData(reservations.filter(r => r.status === 'Pending')).map(res => {
                        const po = pos.find(p => p.id === res.poId);
                        return (
                          <tr 
                            key={res.id} 
                            className="premium-table-row cursor-pointer hover:bg-stone-50 transition-colors group"
                            onClick={() => po && setSelectedPO(po)}
                          >
                            <td className="px-10 py-8">
                              <p className="text-sm font-bold text-ink group-hover:text-ink transition-colors">{investors.find(i => i.id === res.investorId)?.name || 'Institutional Lender'}</p>
                              <p className="mono-label mt-1">{res.investorId}</p>
                            </td>
                            <td className="px-10 py-8">
                              <span className="mono-value bg-stone-100 px-2.5 py-1 rounded text-stone-600 border border-stone-200/50">
                                {po?.poNumber}
                              </span>
                            </td>
                            <td className="px-10 py-8 text-right">
                              <span className="text-sm font-bold text-ink tabular-nums">${res.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                            </td>
                            <td className="px-10 py-8">
                              <span className="text-[11px] font-mono text-stone-500 uppercase tracking-wider">{res.paymentOption.label}</span>
                            </td>
                            <td className="px-10 py-8 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex justify-end gap-3">
                                <button 
                                  onClick={() => handleRejectReservation(res.id)}
                                  className="btn-ghost text-zinc-500 hover:bg-stone-50"
                                >
                                  Reject
                                </button>
                                <button 
                                  onClick={() => handleAcceptReservation(res.id)}
                                  className="btn-primary"
                                >
                                  Accept & Generate
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {reservations.filter(r => r.status === 'Pending').length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-10 py-32 text-center">
                            <div className="max-w-sm mx-auto space-y-4">
                              <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-6">
                                <CheckCircle2 className="text-emerald-500" size={32} />
                              </div>
                              <p className="text-lg font-bold text-ink">Queue Clear</p>
                              <p className="text-sm text-stone-400 leading-relaxed">All lender reservations have been processed. The underwriting queue is currently empty.</p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {adminSubTab === 'legal' && (
              <div className="space-y-10">
                <div className="relative mb-6">
                  <button
                    onClick={() => setLegalDropdownOpen(!legalDropdownOpen)}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[8px] font-mono uppercase tracking-widest border border-stone-200 text-stone-600 hover:bg-stone-50 transition-all bg-white shadow-sm"
                  >
                    <Filter size={8} />
                    Status
                    <ChevronDown size={8} className={`transition-transform ${legalDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {legalDropdownOpen && (
                    <div className="absolute top-full left-0 mt-1 w-32 bg-white border border-stone-200 rounded-lg shadow-lg z-50 p-0.5">
                      {['All', 'Funded(Original)', 'Funded'].map(v => (
                        <label key={v} className="flex items-center gap-1 px-1.5 py-0.5 hover:bg-stone-50 rounded cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={legalFilter.includes(v)}
                            onChange={() => {
                              if (v === 'All') {
                                setLegalFilter(legalFilter.includes('All') ? [] : ['All', 'Funded(Original)', 'Funded']);
                              } else {
                                if (legalFilter.includes(v)) {
                                  setLegalFilter(legalFilter.filter(f => f !== v && f !== 'All'));
                                } else {
                                  setLegalFilter([...legalFilter.filter(f => f !== 'All'), v]);
                                }
                              }
                            }}
                            className="w-2 h-2 rounded-sm border-stone-300 text-ink focus:ring-ink"
                          />
                          <span className="text-[7px] font-mono uppercase tracking-wider text-stone-600 group-hover:text-ink truncate">{v}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div className="premium-card overflow-hidden">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="premium-table-header">
                        <th className="px-10 py-6 cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('id')}>
                          <div className="flex items-center gap-2">
                            Contract ID
                            {sortConfig.key === 'id' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : null)}
                          </div>
                        </th>
                        <th className="px-10 py-6 cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('poId')}>
                          <div className="flex items-center gap-2">
                            PO Reference
                            {sortConfig.key === 'poId' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : null)}
                          </div>
                        </th>
                        <th className="px-10 py-6 cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('investorId')}>
                          <div className="flex items-center gap-2">
                            Lender
                            {sortConfig.key === 'investorId' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : null)}
                          </div>
                        </th>
                        <th className="px-10 py-6 cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('status')}>
                          <div className="flex items-center gap-2">
                            Status
                            {sortConfig.key === 'status' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : null)}
                          </div>
                        </th>
                        <th className="px-10 py-6 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {getSortedData(contracts.filter(c => {
                        const po = pos.find(p => p.id === c.poId);
                        const visibility = po?.visibility || 'Hidden';
                        return legalFilter.includes('All') || legalFilter.includes(visibility);
                      })).map(contract => {
                        const po = pos.find(p => p.id === contract.poId);
                        const investor = investors.find(i => i.id === contract.investorId);
                        
                        return (
                          <tr key={contract.id} className="premium-table-row hover:bg-stone-50 transition-colors group">
                            <td className="px-10 py-8">
                              <p className="text-sm font-bold text-ink tracking-tight">{contract.id}</p>
                              <p className="text-[10px] font-mono text-stone-400 uppercase tracking-widest mt-1">Generated: {new Date(contract.generatedDate).toLocaleDateString()}</p>
                            </td>
                            <td className="px-10 py-8">
                              <span className="mono-value bg-stone-100 px-2.5 py-1 rounded text-stone-600 border border-stone-200/50">
                                {po?.poNumber || contract.poId}
                              </span>
                            </td>
                            <td className="px-10 py-8">
                              <p className="text-sm font-bold text-ink">{investor?.name || 'Lender'}</p>
                            </td>
                            <td className="px-10 py-8">
                              <span className={`status-pill ${contract.status === 'Executed' ? 'status-emerald' : 'status-amber'}`}>
                                {contract.status === 'Executed' ? 'SIGNED' : 'PENDING SIGNATURE'}
                              </span>
                            </td>
                            <td className="px-10 py-8 text-right">
                              <div className="flex justify-end gap-3">
                                {!contract.originalPoId ? (
                                  /* ── ORIGINAL CONTRACT: Download Unsigned, Finalize, Delete ── */
                                  <>
                                    <button
                                      onClick={() => {
                                        const reservation = reservations.find(r => r.id === contract.reservationId);
                                        if (investor && po && reservation) {
                                          const blobUrl = generateContractPDF(contract, investor, po, reservation);
                                          const link = document.createElement('a');
                                          link.href = blobUrl;
                                          link.download = `Agreement_${po?.poNumber || contract.id}.pdf`;
                                          link.click();
                                        }
                                      }}
                                      className="btn-ghost text-ink hover:bg-stone-100 flex items-center gap-2"
                                    >
                                      <FileText size={14} />
                                      Download Unsigned
                                    </button>
                                    {contract.status !== 'Signed' && (
                                      <>
                                        <button
                                          onClick={() => handleFinalizeContract(contract.id)}
                                          className="btn-ghost !text-[10px] !px-3 !py-1.5 border border-ink/10 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200"
                                        >
                                          Finalize & Re-issue PO
                                        </button>
                                        <button
                                          onClick={async () => {
                                            if (confirm('Delete this contract and reset the reservation to Pending? The lender keeps their spot — you can re-accept to generate a new contract.')) {
                                              try {
                                                await deleteDoc(doc(db, 'contracts', contract.id));
                                                await updateDoc(doc(db, 'reservations', contract.reservationId), { status: 'Pending' });
                                                await updateDoc(doc(db, 'purchaseOrders', contract.poId), {
                                                  reservationStatus: 'Pending',
                                                  reservedBy: deleteField()
                                                });
                                              } catch (err) {
                                                console.error('Error deleting contract:', err);
                                                handleFirestoreError(err, 'delete', `contracts/${contract.id}`);
                                              }
                                            }
                                          }}
                                          className="btn-ghost text-rose-600 hover:bg-rose-50"
                                        >
                                          Delete
                                        </button>
                                      </>
                                    )}
                                  </>
                                ) : (
                                  /* ── NEW CONTRACT (post-finalize): Upload/View Signed + Rollback ── */
                                  <>
                                    {contract.signedDocumentUrl ? (
                                      <button
                                        onClick={() => {
                                          const link = document.createElement('a');
                                          link.href = contract.signedDocumentUrl!;
                                          link.download = `signed-contract-${contract.id}.pdf`;
                                          link.click();
                                        }}
                                        className="btn-ghost text-emerald-600 hover:bg-emerald-50 flex items-center gap-2"
                                      >
                                        <ShieldCheck size={14} />
                                        View Signed
                                      </button>
                                    ) : (
                                      <button
                                        onClick={() => {
                                          const input = document.createElement('input');
                                          input.type = 'file';
                                          input.accept = '.pdf,.doc,.docx';
                                          input.onchange = (e: any) => {
                                            const file = e.target.files?.[0];
                                            if (!file) return;
                                            const reader = new FileReader();
                                            reader.onload = () => {
                                              handleSignContract(contract.id, reader.result as string);
                                            };
                                            reader.readAsDataURL(file);
                                          };
                                          input.click();
                                        }}
                                        className="btn-premium flex items-center gap-2"
                                      >
                                        <Upload size={14} />
                                        Upload Signed
                                      </button>
                                    )}
                                    <button
                                      onClick={async () => {
                                        const originalContract = contracts.find(c => c.id === contract.originalPoId);
                                        const reissuedPo = pos.find(p => p.id === contract.poId);
                                        const originalPo = reissuedPo?.originalPoId
                                          ? pos.find(p => p.id === reissuedPo.originalPoId)
                                          : originalContract
                                            ? pos.find(p => p.id === originalContract.poId)
                                            : null;
                                        const reissuedPoNbr = reissuedPo?.poNumber;
                                        const originalPoNbr = reissuedPo?.originalPoNumber || originalPo?.poNumber;
                                        const reservation = reservations.find(r => r.id === contract.reservationId || (originalContract && r.id === originalContract.reservationId));
                                        if (confirm(`Roll back this contract?\n\n- Cancel reissued PO${reissuedPoNbr ? ` (${reissuedPoNbr})` : ''} in Acumatica\n- Reopen original PO${originalPoNbr ? ` (${originalPoNbr})` : ''} back to Open\n- Reset original contract to Draft so you can retry\n\nProceed?`)) {
                                          try {
                                            // 1. Acumatica rollback
                                            const rollbackRes = await fetch('/api/acumatica/po/rollback', {
                                              method: 'POST',
                                              headers: { 'Content-Type': 'application/json' },
                                              body: JSON.stringify({ reissuedPoNumber: reissuedPoNbr, originalPoNumber: originalPoNbr })
                                            });
                                            if (!rollbackRes.ok) {
                                              const errBody = await rollbackRes.json();
                                              throw new Error(errBody.error || 'Acumatica rollback failed');
                                            }
                                            const rollbackData = await rollbackRes.json();
                                            console.log('Rollback log:', rollbackData.log);

                                            // 2. Reset original contract to Draft
                                            if (originalContract) {
                                              await updateDoc(doc(db, 'contracts', originalContract.id), { status: 'Draft' });
                                            }

                                            // 3. Delete this new (post-finalize) contract
                                            await deleteDoc(doc(db, 'contracts', contract.id));

                                            // 4. Reset reservation back to original PO
                                            if (reservation && originalPo) {
                                              await updateDoc(doc(db, 'reservations', reservation.id), {
                                                poId: originalPo.id,
                                                originalPoId: deleteField()
                                              });
                                            }

                                            // 5. Reset original PO in Firestore
                                            if (originalPo) {
                                              await updateDoc(doc(db, 'purchaseOrders', originalPo.id), {
                                                status: 'To be Shipped',
                                                visibility: 'Published',
                                                isPublished: true,
                                                reservationStatus: 'Accepted',
                                                reissuedPoId: deleteField(),
                                                reservedBy: deleteField()
                                              });
                                            }

                                            // 6. Hide reissued PO in Firestore
                                            if (reissuedPo) {
                                              await deleteDoc(doc(db, 'purchaseOrders', reissuedPo.id));
                                            }
                                          } catch (err: any) {
                                            console.error('Rollback error:', err);
                                            alert(`Rollback failed: ${err.message}`);
                                          }
                                        }
                                      }}
                                      className="btn-ghost !text-[10px] !px-3 !py-1.5 text-amber-600 hover:bg-amber-50 border border-amber-200"
                                    >
                                      ↩ Rollback Acumatica
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {contracts.length === 0 && (
                        <tr>
                          <td colSpan={5} className="px-10 py-32 text-center">
                            <div className="max-w-sm mx-auto space-y-4">
                              <div className="w-16 h-16 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-6">
                                <FileText className="text-stone-300" size={32} />
                              </div>
                              <p className="text-lg font-bold text-ink">No Contracts</p>
                              <p className="text-sm text-stone-400 leading-relaxed">Contracts will appear here once reservations are accepted.</p>
                            </div>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {adminSubTab === 'finance' && (
              <div className="space-y-10">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="premium-card p-10">
                    <p className="mono-label mb-3">Total Yield Paid</p>
                    <p className="text-4xl font-bold text-ink tracking-tight">
                      ${transactions.filter(tx => tx.linkedPoId && !tx.description.includes('Principal')).reduce((acc, tx) => acc + tx.amount, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="premium-card p-10">
                    <p className="mono-label mb-3">Active Funded POs</p>
                    <p className="text-4xl font-bold text-ink tracking-tight">{activeFundedPOs.filter(p => p.status === 'Funded').length}</p>
                  </div>
                </div>

                <div className="premium-card p-10">
                  <h3 className="mono-label mb-8">Funded Assets & Repayment Schedule</h3>
                  <div className="overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="premium-table-header">
                          <th className="px-6 py-4 cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('poNumber')}>
                            <div className="flex items-center gap-2">
                              PO Reference
                              {sortConfig.key === 'poNumber' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : null)}
                            </div>
                          </th>
                          <th className="px-6 py-4 cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('reservedBy')}>
                            <div className="flex items-center gap-2">
                              Lender
                              {sortConfig.key === 'reservedBy' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : null)}
                            </div>
                          </th>
                          <th className="px-6 py-4 text-right cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('amount')}>
                            <div className="flex items-center justify-end gap-2">
                              Principal
                              {sortConfig.key === 'amount' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : null)}
                            </div>
                          </th>
                          <th className="px-6 py-4 cursor-pointer hover:bg-stone-100 transition-colors" onClick={() => handleSort('status')}>
                            <div className="flex items-center gap-2">
                              Status
                              {sortConfig.key === 'status' && (sortConfig.direction === 'asc' ? <ArrowUp size={12} /> : sortConfig.direction === 'desc' ? <ArrowDown size={12} /> : null)}
                            </div>
                          </th>
                          <th className="px-6 py-4">Documents</th>
                          <th className="px-6 py-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {getSortedData(activeFundedPOs)
                          .map(po => {
                            const originalPo = pos.find(p => p.reissuedPoId === po.id);
                            const reservation = reservations.find(r => (r.poId === po.id || (originalPo && r.poId === originalPo.id)) && r.status === 'Accepted');
                          const investor = investors.find(i => i.id === reservation?.investorId);
                          const contract = contracts.find(c => c.poId === po.id || (originalPo && c.poId === originalPo.id));
                          return (
                            <tr key={po.id} className="premium-table-row hover:bg-stone-50 cursor-pointer" onClick={() => setSelectedFundedPO(po)}>
                              <td className="px-6 py-6">
                                <p className="text-sm font-bold text-ink">{po.poNumber}</p>
                                <p className="text-[10px] font-mono text-stone-400 mt-1">{po.vendorName}</p>
                              </td>
                              <td className="px-6 py-6">
                                <p className="text-sm font-medium text-stone-600">{investor?.name || 'Institutional Lender'}</p>
                              </td>
                              <td className="px-6 py-6 text-right">
                                <p className="text-sm font-bold text-ink">${po.amount.toLocaleString()}</p>
                              </td>
                              <td className="px-6 py-6">
                                <span className={`status-pill ${po.status === 'Completed' ? 'status-emerald' : 'status-amber'}`}>
                                  {po.status === 'Completed' ? 'REPAID' : 'FUNDED'}
                                </span>
                              </td>
                              <td className="px-6 py-6">
                                <div className="flex gap-2">
                                  {contract?.signedDocumentUrl ? (
                                    <a href={contract.signedDocumentUrl} target="_blank" rel="noreferrer" className="p-2 bg-emerald-50 rounded-lg text-emerald-600 hover:bg-emerald-100 transition-colors" title="Signed Agreement">
                                      <ShieldCheck size={14} />
                                    </a>
                                  ) : contract?.unsignedDocumentUrl || (reservation && investor && po) ? (
                                    <button 
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (investor && po && reservation && contract) {
                                          const url = generateContractPDF(contract, investor, po, reservation);
                                          window.open(url, '_blank');
                                        }
                                      }}
                                      className="p-2 bg-stone-100 rounded-lg text-stone-400 hover:text-ink transition-colors" 
                                      title="Unsigned Agreement"
                                    >
                                      <FileText size={14} />
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                              <td className="px-6 py-6 text-right">
                                <button className="btn-ghost !text-[10px] !px-3 !py-1.5">View Audit Trail</button>
                              </td>
                            </tr>
                          );
                        })}
                        {activeFundedPOs.length === 0 && (
                          <tr>
                            <td colSpan={6} className="px-6 py-20 text-center text-stone-400 font-mono text-xs italic">
                              No funded assets currently active
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="premium-card p-10">
                  <h3 className="mono-label mb-8">Record Manual Payment</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
                    <div className="space-y-3">
                      <label className="mono-label px-1">Select PO</label>
                      <select 
                        value={paymentForm.poId}
                        onChange={(e) => setPaymentForm(prev => ({ ...prev, poId: e.target.value }))}
                        className="w-full bg-stone-50 border border-stone-200 rounded-2xl p-4 text-sm focus:ring-1 focus:ring-ink focus:border-ink outline-none transition-all"
                      >
                        <option value="">Choose PO...</option>
                        {activeFundedPOs.filter(p => p.status === 'Funded').map(p => (
                          <option key={p.id} value={p.id}>{p.poNumber} - {p.vendorName || p.vendor}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-3">
                      <label className="mono-label px-1">Amount ($)</label>
                      <input 
                        type="number"
                        value={paymentForm.amount || ''}
                        onChange={(e) => setPaymentForm(prev => ({ ...prev, amount: Number(e.target.value) }))}
                        placeholder="0.00"
                        className="w-full bg-stone-50 border border-stone-200 rounded-2xl p-4 text-sm focus:ring-1 focus:ring-ink focus:border-ink outline-none transition-all"
                      />
                    </div>
                    <button 
                      onClick={() => {
                        if (paymentForm.poId && paymentForm.amount > 0) {
                          handleRecordPayment(paymentForm.poId, paymentForm.amount);
                          setPaymentForm({ poId: '', amount: 0, type: 'Principal' });
                        }
                      }}
                      disabled={!paymentForm.poId || paymentForm.amount <= 0}
                      className="btn-primary py-4 disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      Record Payment
                    </button>
                  </div>
                </div>

                <div className="premium-card p-10">
                  <div className="flex justify-between items-center mb-10">
                    <h3 className="mono-label">Bank Reconciliation Ledger</h3>
                    <div className="flex gap-4">
                      <select 
                        className="bg-stone-50 border border-stone-200 rounded-xl py-2 px-4 text-[10px] font-mono uppercase tracking-widest outline-none"
                        value={paymentForm.poId}
                        onChange={(e) => setPaymentForm(prev => ({ ...prev, poId: e.target.value }))}
                      >
                        <option value="">All Payments</option>
                        {activeFundedPOs.map(po => (
                          <option key={po.id} value={po.id}>{po.poNumber}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="space-y-4">
                    {transactions
                      .filter(tx => !paymentForm.poId || tx.linkedPoId === paymentForm.poId)
                      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                      .map(tx => {
                        const po = pos.find(p => p.id === tx.linkedPoId);
                        const originalPo = pos.find(p => p.reissuedPoId === tx.linkedPoId);
                        const displayPo = po || originalPo;
                        return (
                          <div key={tx.id} className="flex justify-between items-center p-6 hover:bg-stone-50 rounded-3xl transition-all border border-transparent hover:border-stone-200/50 group">
                            <div className="flex items-center gap-6">
                              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${
                                tx.type === 'Credit' 
                                  ? 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100' 
                                  : 'bg-rose-50 text-rose-600 group-hover:bg-rose-100'
                              }`}>
                                <Banknote size={24} strokeWidth={1.5} />
                              </div>
                              <div>
                                <p className="text-sm font-bold text-ink">{tx.description}</p>
                                <p className="mono-label mt-1">{tx.date} {displayPo && `• PO: ${displayPo.poNumber} (${displayPo.vendorName})`}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-10">
                              <p className={`text-lg font-bold tabular-nums tracking-tight ${tx.type === 'Credit' ? 'text-emerald-600' : 'text-rose-600'}`}>
                                {tx.type === 'Credit' ? '+' : '-'}${tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </p>
                              <span className="status-pill status-emerald">Reconciled</span>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-50">
        <div className="flex flex-col items-center gap-6">
          <div className="w-16 h-16 border-4 border-stone-200 border-t-ink rounded-full animate-spin" />
          <p className="mono-label animate-pulse">Establishing Secure Session...</p>
        </div>
      </div>
    );
  }

  if (!user) return renderLoginPage();

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-zinc-900 font-sans selection:bg-zinc-900 selection:text-white">
      {/* Navigation Rail */}
      <nav className="fixed left-0 top-0 bottom-0 w-24 bg-white border-r border-zinc-200 flex flex-col items-center py-10 gap-10 z-50">
        <button 
          onClick={() => {
            setAdminSubTab('inventory');
            setViewMode('admin');
          }}
          className="p-4 rounded-2xl transition-all text-ink hover:bg-stone-50 hover:scale-105 active:scale-95 mb-8"
          title="Home / Dashboard"
        >
          <Home size={28} strokeWidth={1.5} />
        </button>
        
        <div className="flex flex-col gap-6 flex-1">
          {user.role === 'lender' ? (
            <button 
              className="p-4 rounded-2xl bg-zinc-100 text-zinc-900 shadow-sm"
              title="Lender Portal"
            >
              <Users size={28} />
            </button>
          ) : (
            <>
              <button 
                onClick={() => setViewMode('admin')}
                className={`p-4 rounded-2xl transition-all ${viewMode === 'admin' ? 'bg-stone-100 text-ink shadow-inner' : 'text-zinc-400 hover:bg-stone-50 hover:text-ink'}`}
                title="Admin Dashboard"
              >
                <LayoutDashboard size={28} strokeWidth={1.5} />
              </button>
              <button 
                onClick={() => setViewMode('lender')}
                className={`p-4 rounded-2xl transition-all ${viewMode === 'lender' ? 'bg-stone-100 text-ink shadow-inner' : 'text-zinc-400 hover:bg-stone-50 hover:text-ink'}`}
                title="Lender View (Preview)"
              >
                <Users size={28} strokeWidth={1.5} />
              </button>
            </>
          )}
        </div>

        <div className="mt-auto flex flex-col gap-6">
          <button 
            onClick={handleLogout}
            className="p-4 rounded-2xl text-zinc-400 hover:text-rose-600 transition-colors"
            title="Logout"
          >
            <LogOut size={28} />
          </button>
          <div className="w-10 h-10 rounded-2xl bg-stone-100 text-ink flex items-center justify-center text-xs font-bold border border-stone-200">
            {user.email.substring(0, 2).toUpperCase()}
          </div>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className="pl-24 min-h-screen">
        <AnimatePresence mode="wait">
          <motion.div
            key={user.role + viewMode}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            {(user.role === 'lender' || viewMode === 'lender') ? renderLenderPortal() : renderAdminPortal()}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* System Status Overlay (Floating) */}
      <div className="fixed bottom-10 right-10 flex items-center gap-8 bg-white/80 backdrop-blur-2xl border border-stone-200 px-10 py-5 rounded-[2.5rem] shadow-2xl z-50 pointer-events-auto">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <div className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping opacity-75" />
          </div>
          <span className="text-[10px] font-mono uppercase tracking-[0.3em] text-ink font-bold">Pipeline: Active</span>
        </div>
        <div className="w-px h-8 bg-stone-200" />
        <div className="flex items-center gap-10">
          <div className="text-right">
            <p className="text-[9px] font-mono text-zinc-400 uppercase tracking-[0.2em] mb-1">Latency</p>
            <p className="text-sm font-mono text-ink font-bold">0.04ms</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-mono text-zinc-400 uppercase tracking-[0.2em] mb-1">Nodes</p>
            <p className="text-sm font-mono text-ink font-bold">12/12</p>
          </div>
          <div className="text-right">
            <p className="text-[9px] font-mono text-zinc-400 uppercase tracking-[0.2em] mb-1">Portal</p>
            <p className="text-sm font-mono text-emerald-600 font-bold">{user.role?.toUpperCase()}</p>
          </div>
        </div>
      </div>

      {/* Reservation Modal */}
      <AnimatePresence>
        {selectedPO && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedPO(null)}
              className="fixed inset-0 bg-ink/40 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-4xl bg-white rounded-[3rem] shadow-2xl overflow-hidden my-auto border border-stone-200/60"
            >
              <div className="p-12">
                <div className="flex justify-between items-start mb-12">
                  <div>
                    <h3 className="display-text !text-3xl">
                      {viewMode === 'admin' ? (
                        <>Purchase Order <span className="italic font-serif">Details</span></>
                      ) : (
                        <>Reserve <span className="italic font-serif">Purchase Order</span></>
                      )}
                    </h3>
                    <p className="mono-label mt-3">Financing PO: <span className="font-mono text-ink font-bold">{selectedPO.poNumber}</span></p>
                {viewMode === 'lender' && reservations.find(r => r.poId === selectedPO.id && r.investorId !== currentLender?.id && (r.status === 'Pending' || r.status === 'Accepted')) && (
                  <div className="mt-6 p-4 bg-amber-50/50 border border-amber-100 rounded-2xl flex items-center gap-4">
                    <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                    <p className="text-[10px] font-mono text-amber-700 uppercase tracking-widest font-bold">
                      Institutional Alert: This asset has active competing reservations.
                    </p>
                  </div>
                )}
                  </div>
                  <div className="text-right">
                    <p className="mono-label mb-2">Total Facility Amount</p>
                    <p className="text-4xl font-light tracking-tighter text-ink">${selectedPO.amount.toLocaleString()}</p>
                  </div>
                </div>

                {/* PO Items Table */}
                <div className="mb-12">
                  <h4 className="mono-label mb-6">Itemized Asset Details</h4>
                  <div className="border border-stone-100 rounded-3xl overflow-hidden shadow-sm">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-stone-50/80 border-b border-stone-100">
                          <th className="px-6 py-4 mono-label !text-zinc-500">Inventory ID</th>
                          <th className="px-6 py-4 mono-label !text-zinc-500">Description</th>
                          <th className="px-6 py-4 mono-label !text-zinc-500 text-right">Qty</th>
                          <th className="px-6 py-4 mono-label !text-zinc-500 text-right">Unit Cost</th>
                          <th className="px-6 py-4 mono-label !text-zinc-500 text-right">Ext. Cost</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-50">
                        {selectedPO.items.map(item => (
                          <tr key={item.id} className="hover:bg-stone-50/50 transition-colors">
                            <td className="px-6 py-4 text-ink font-mono text-[10px]">{item.inventoryId}</td>
                            <td className="px-6 py-4 text-ink font-medium">{item.description}</td>
                            <td className="px-6 py-4 text-zinc-500 text-right font-mono">{item.quantity} {item.uom}</td>
                            <td className="px-6 py-4 text-zinc-500 text-right font-mono">${item.unitCost.toLocaleString()}</td>
                            <td className="px-6 py-4 font-bold text-ink text-right font-mono">${item.extCost.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                
                {/* Lender contract actions — shown when lender has a reservation on this PO */}
                {viewMode === 'lender' && (() => {
                  const myRes = reservations.find(r => r.poId === selectedPO.id && r.investorId === currentLender?.id && r.status !== 'Rejected');
                  const myContract = myRes ? contracts.find(c => c.reservationId === myRes.id && !contracts.some(other => other.originalPoId === c.id)) : null;
                  if (!myRes || !myContract) return null;
                  return (
                    <div className="mb-10 p-6 bg-stone-50 rounded-2xl border border-stone-100 space-y-4">
                      <p className="mono-label">Agreement</p>
                      <p className="text-[10px] font-mono text-zinc-400 uppercase tracking-widest">{myContract.status}</p>
                      <div className="flex gap-3 flex-wrap">
                        {currentLender && (
                          <button
                            onClick={() => {
                              const blobUrl = generateContractPDF(myContract, currentLender, selectedPO, myRes);
                              const link = document.createElement('a');
                              link.href = blobUrl;
                              link.download = `Agreement_${selectedPO.poNumber}.pdf`;
                              link.click();
                            }}
                            className="btn-ghost flex items-center gap-2 text-xs"
                          >
                            <Download size={13} />
                            Download Unsigned
                          </button>
                        )}
                        {myContract.signedDocumentUrl ? (
                          <button
                            onClick={() => {
                              const link = document.createElement('a');
                              link.href = myContract.signedDocumentUrl!;
                              link.download = `Signed_Agreement_${selectedPO.poNumber}.pdf`;
                              link.click();
                            }}
                            className="btn-ghost flex items-center gap-2 text-xs text-emerald-600 hover:bg-emerald-50"
                          >
                            <ShieldCheck size={13} />
                            Download Signed
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              const input = document.createElement('input');
                              input.type = 'file';
                              input.accept = '.pdf,.doc,.docx';
                              input.onchange = (e: any) => {
                                const file = e.target.files?.[0];
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onload = () => {
                                  handleSignContract(myContract.id, reader.result as string);
                                };
                                reader.readAsDataURL(file);
                              };
                              input.click();
                            }}
                            className="btn-ghost flex items-center gap-2 text-xs text-amber-600 hover:bg-amber-50"
                          >
                            <Upload size={13} />
                            Upload Signed Agreement
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })()}

                {(viewMode === 'lender' && !reservations.some(r => r.poId === selectedPO.id && r.investorId === currentLender?.id && r.status !== 'Rejected')) ? (
                  <form onSubmit={handleSubmitReservation} className="space-y-10">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div className="space-y-3">
                        <label className="mono-label ml-1">Lender Entity</label>
                        <input 
                          type="text" 
                          value={currentLender?.name || ''} 
                          readOnly
                          className="w-full bg-stone-100/50 border border-stone-200 rounded-2xl py-5 px-6 text-sm text-zinc-500 cursor-not-allowed font-medium"
                        />
                      </div>
                      <div className="space-y-3">
                        <label className="mono-label ml-1">Authorized Signatory</label>
                        <input 
                          type="text" 
                          value={currentLender?.email || ''} 
                          readOnly
                          className="w-full bg-stone-100/50 border border-stone-200 rounded-2xl py-5 px-6 text-sm text-zinc-500 cursor-not-allowed font-medium"
                        />
                      </div>
                      <div className="space-y-3">
                        <label className="mono-label ml-1">Reservation Allocation</label>
                        <div className="relative">
                          <span className="absolute left-6 top-1/2 -translate-y-1/2 text-zinc-400 text-sm font-mono">$</span>
                          <input 
                            type="number" 
                            value={reservationAmount}
                            readOnly
                            className="w-full bg-stone-100/50 border border-stone-200 rounded-2xl py-5 pl-10 pr-6 text-sm text-zinc-500 cursor-not-allowed font-bold"
                            required
                          />
                        </div>
                      </div>
                      <div className="space-y-3">
                        <label className="mono-label ml-1">Financial Structure</label>
                        <div className="relative">
                          <select 
                            value={selectedPaymentOption.label}
                            onChange={(e) => {
                              const option = paymentOptions.find(o => o.label === e.target.value);
                              if (option) setSelectedPaymentOption(option);
                            }}
                            className="w-full bg-white border border-stone-200 rounded-2xl py-5 px-6 text-sm focus:outline-none focus:border-ink focus:ring-4 focus:ring-ink/5 appearance-none font-medium cursor-pointer"
                            required
                          >
                            {paymentOptions.map(option => (
                              <option key={option.label} value={option.label}>{option.label}</option>
                            ))}
                          </select>
                          <ChevronRight className="absolute right-6 top-1/2 -translate-y-1/2 text-zinc-400 rotate-90 pointer-events-none" size={16} />
                        </div>
                      </div>
                    </div>

                    <div className="bg-stone-50/80 p-8 rounded-[2rem] border border-stone-100 space-y-4 shadow-inner">
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-500 text-xs font-mono uppercase tracking-widest">Projected Interest Yield ({selectedPaymentOption.interest}%)</span>
                        <span className="text-xl font-bold text-emerald-600 tracking-tight">${(reservationAmount * (selectedPaymentOption.interest / 100)).toLocaleString()}</span>
                      </div>
                      <div className="h-px bg-stone-200/50" />
                      <div className="flex justify-between items-center">
                        <span className="text-zinc-500 text-xs font-mono uppercase tracking-widest">Total Facility Repayment</span>
                        <span className="text-2xl font-bold text-ink tracking-tighter">${(reservationAmount * (1 + selectedPaymentOption.interest / 100)).toLocaleString()}</span>
                      </div>
                    </div>

                    <div className="flex gap-6 pt-4">
                      {reservations.find(r => r.poId === selectedPO.id && r.investorId === currentLender?.id && r.status === 'Pending') ? (
                        <button 
                          type="button"
                          onClick={async () => {
                            const res = reservations.find(r => r.poId === selectedPO.id && r.investorId === currentLender?.id && r.status === 'Pending');
                            if (res) {
                              await deleteDoc(doc(db, 'reservations', res.id)).catch(err => handleFirestoreError(err, 'delete', `reservations/${res.id}`));
                              setSelectedPO(null);
                            }
                          }}
                          className="btn-secondary flex-1 py-5 !bg-rose-50 !text-rose-600 !border-rose-100 hover:!bg-rose-100"
                        >
                          Cancel Reservation
                        </button>
                      ) : (
                        <button 
                          type="button"
                          onClick={() => setSelectedPO(null)}
                          className="btn-secondary flex-1 py-5"
                        >
                          Close
                        </button>
                      )}
                      <button 
                        type="submit"
                        disabled={isSubmitting || reservations.some(r => r.poId === selectedPO.id && r.investorId === currentLender?.id && r.status !== 'Rejected')}
                        className="btn-primary flex-[2] py-5 shadow-xl shadow-ink/10 disabled:opacity-50"
                      >
                        {isSubmitting ? 'Processing...' : 'Confirm Reservation'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="space-y-10">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
                      <div className="bg-stone-50 p-6 rounded-2xl border border-stone-100">
                        <p className="mono-label mb-2">Vendor</p>
                        <p className="text-lg font-bold text-ink">{selectedPO.vendorName || selectedPO.vendor}</p>
                        {selectedPO.vendorName && <p className="text-xs text-zinc-500 font-medium">{selectedPO.vendor}</p>}
                        {selectedPO.vendorRef && <p className="text-[10px] font-mono text-zinc-400 mt-1">Ref: {selectedPO.vendorRef}</p>}
                      </div>
                      <div className="bg-stone-50 p-6 rounded-2xl border border-stone-100">
                        <p className="mono-label mb-2">Status</p>
                        <span className="status-pill status-emerald">{selectedPO.status}</span>
                      </div>
                      <div className="bg-stone-50 p-6 rounded-2xl border border-stone-100">
                        <p className="mono-label mb-2">Location</p>
                        <p className="text-lg font-bold text-ink">{selectedPO.location}</p>
                      </div>
                      <div className="bg-stone-50 p-6 rounded-2xl border border-stone-100">
                        <p className="mono-label mb-2">Sync Date</p>
                        <p className="text-lg font-bold text-ink">{selectedPO.date}</p>
                      </div>
                      {selectedPO.promisedOn && (
                        <div className="bg-stone-50 p-6 rounded-2xl border border-stone-100">
                          <p className="mono-label mb-2">Promised Date</p>
                          <p className="text-lg font-bold text-ink">{selectedPO.promisedOn}</p>
                        </div>
                      )}
                    </div>

                    {selectedPO.vendorDetails && (
                      <div className="bg-stone-50/50 p-8 rounded-[2rem] border border-stone-100">
                        <h4 className="mono-label mb-6">Vendor Legal Details</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                          <div>
                            <p className="text-[10px] font-mono text-zinc-400 uppercase mb-1">Legal Name</p>
                            <p className="text-sm font-bold text-ink">{selectedPO.vendorDetails.legalName || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-mono text-zinc-400 uppercase mb-1">Contact Info</p>
                            <p className="text-sm font-medium text-ink">{selectedPO.vendorDetails.email || 'N/A'}</p>
                            <p className="text-xs text-zinc-500">{selectedPO.vendorDetails.phone || 'N/A'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-mono text-zinc-400 uppercase mb-1">Registered Address</p>
                            <p className="text-sm font-medium text-ink leading-relaxed">{selectedPO.vendorDetails.address || 'N/A'}</p>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    <div className="flex gap-6 pt-4">
                      <button 
                        type="button"
                        onClick={() => setSelectedPO(null)}
                        className="btn-primary w-full py-5"
                      >
                        Close Details
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Funded PO Detail Modal */}
      <AnimatePresence>
        {selectedFundedPO && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedFundedPO(null)}
              className="fixed inset-0 bg-ink/40 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-4xl bg-white rounded-[3rem] shadow-2xl relative z-10 overflow-hidden border border-stone-200/60 max-h-[90vh] overflow-y-auto"
            >
              <div className="p-12">
                <div className="flex justify-between items-start mb-12">
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="status-pill status-emerald">Funded Asset</span>
                      <span className="mono-label !text-zinc-400">PO-{selectedFundedPO.poNumber}</span>
                    </div>
                    <h3 className="display-text text-4xl">{selectedFundedPO.vendorName}</h3>
                  </div>
                  <button onClick={() => setSelectedFundedPO(null)} className="p-3 hover:bg-stone-50 rounded-full transition-colors">
                    <X size={24} className="text-stone-400" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
                  <div className="md:col-span-2 space-y-12">
                    {/* Section 0: Financial Summary (Comparative) */}
                    {(() => {
                      const originalPo = pos.find(p => p.reissuedPoId === selectedFundedPO.id);
                      if (!originalPo) return null;
                      
                      const principal = originalPo.amount;
                      const total = selectedFundedPO.amount;
                      const interest = total - principal;
                      
                      return (
                        <section className="space-y-6">
                          <div className="flex items-center gap-3">
                            <Banknote size={18} className="text-ink" />
                            <h4 className="mono-label !text-ink">Financial Summary</h4>
                          </div>
                          <div className="grid grid-cols-3 gap-4">
                            <div className="bg-stone-50 p-6 rounded-3xl border border-stone-100">
                              <p className="text-[10px] font-mono text-stone-400 uppercase tracking-widest mb-2">Principal (Original PO)</p>
                              <p className="text-2xl font-light tracking-tight text-ink">${principal.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                            </div>
                            <div className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100">
                              <p className="text-[10px] font-mono text-emerald-600/70 uppercase tracking-widest mb-2">Interest Earned</p>
                              <p className="text-2xl font-light tracking-tight text-emerald-600">+${interest.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                            </div>
                            <div className="bg-ink p-6 rounded-3xl border border-ink">
                              <p className="text-[10px] font-mono text-white/50 uppercase tracking-widest mb-2">Total (New PO)</p>
                              <p className="text-2xl font-light tracking-tight text-white">${total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                            </div>
                          </div>
                        </section>
                      );
                    })()}

                    {/* Section 1: Inventory Details */}
                    <section className="space-y-6">
                      <div className="flex items-center gap-3">
                        <Package size={18} className="text-ink" />
                        <h4 className="mono-label !text-ink">Inventory & Line Items</h4>
                      </div>
                      <div className="bg-stone-50 rounded-3xl border border-stone-100 overflow-hidden">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-stone-100/50">
                              <th className="px-6 py-4 text-[10px] font-mono text-stone-400 uppercase tracking-widest">Item</th>
                              <th className="px-6 py-4 text-[10px] font-mono text-stone-400 uppercase tracking-widest text-right">Qty</th>
                              <th className="px-6 py-4 text-[10px] font-mono text-stone-400 uppercase tracking-widest text-right">Cost</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-100">
                            {selectedFundedPO.items.map((item, idx) => (
                              <tr key={idx} className="text-xs">
                                <td className="px-6 py-4">
                                  <p className="font-bold text-ink">{item.inventoryId}</p>
                                  <p className="text-stone-400 mt-0.5">{item.description}</p>
                                </td>
                                <td className="px-6 py-4 text-right font-mono">{item.quantity} {item.uom}</td>
                                <td className="px-6 py-4 text-right font-mono">${item.extCost.toLocaleString()}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    {/* Section 2: Reservation & Legal */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <section className="space-y-6">
                        <div className="flex items-center gap-3">
                          <Users size={18} className="text-ink" />
                          <h4 className="mono-label !text-ink">Reservation Audit</h4>
                        </div>
                        {(() => {
                          const originalPo = pos.find(p => p.reissuedPoId === selectedFundedPO.id);
                          const res = reservations.find(r => (r.poId === selectedFundedPO.id || (originalPo && r.poId === originalPo.id)) && r.status === 'Accepted');
                          const lender = investors.find(i => i.id === res?.investorId);
                          return (
                            <div className="bg-stone-50 p-6 rounded-3xl border border-stone-100 space-y-4">
                              <div>
                                <p className="text-[10px] font-mono text-stone-400 uppercase tracking-widest">Lender Entity</p>
                                <p className="text-sm font-bold text-ink mt-1">{lender?.name || 'Institutional Lender'}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-mono text-stone-400 uppercase tracking-widest">Reservation Date</p>
                                <p className="text-sm font-mono text-stone-600 mt-1">{res?.timestamp ? new Date(res.timestamp).toLocaleString() : 'N/A'}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-mono text-stone-400 uppercase tracking-widest">Terms</p>
                                <p className="text-sm font-mono text-emerald-600 font-bold mt-1">{res?.paymentOption.label} ({res?.paymentOption.interest}%)</p>
                              </div>
                            </div>
                          );
                        })()}
                      </section>

                      <section className="space-y-6">
                        <div className="flex items-center gap-3">
                          <FileText size={18} className="text-ink" />
                          <h4 className="mono-label !text-ink">Legal Execution</h4>
                        </div>
                        {(() => {
                          const originalPo = pos.find(p => p.reissuedPoId === selectedFundedPO.id);
                          const contract = contracts.find(c => c.poId === selectedFundedPO.id || (originalPo && c.poId === originalPo.id));
                          return (
                            <div className="bg-stone-50 p-6 rounded-3xl border border-stone-100 space-y-4">
                              <div>
                                <p className="text-[10px] font-mono text-stone-400 uppercase tracking-widest">Contract ID</p>
                                <p className="text-sm font-mono text-ink mt-1">{contract?.id || 'N/A'}</p>
                              </div>
                              <div>
                                <p className="text-[10px] font-mono text-stone-400 uppercase tracking-widest">Execution Status</p>
                                <p className="text-sm font-mono text-stone-600 mt-1">{contract?.status === 'Executed' ? 'Signed' : 'Pending Signature'}</p>
                              </div>
                              <div className="flex flex-col gap-2">
                                {contract?.unsignedDocumentUrl && (
                                  <a 
                                    href={contract.unsignedDocumentUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="w-full py-3 bg-white border border-stone-200 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-stone-100 transition-all flex items-center justify-center gap-2"
                                  >
                                    <FileText size={14} /> View Unsigned Agreement
                                  </a>
                                )}
                                {contract?.signedDocumentUrl && (
                                  <a 
                                    href={contract.signedDocumentUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="w-full py-3 bg-emerald-50 border border-emerald-100 text-emerald-600 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-emerald-100 transition-all flex items-center justify-center gap-2"
                                  >
                                    <ShieldCheck size={14} /> View Signed Agreement
                                  </a>
                                )}
                              </div>
                            </div>
                          );
                        })()}
                      </section>
                    </div>

                    {/* Section 3: Financial Records */}
                    <section className="space-y-6">
                      <div className="flex items-center gap-3">
                        <CreditCard size={18} className="text-ink" />
                        <h4 className="mono-label !text-ink">Financial Ledger</h4>
                      </div>
                      <div className="bg-stone-50 rounded-3xl border border-stone-100 overflow-hidden">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-stone-100/50">
                              <th className="px-6 py-4 text-[10px] font-mono text-stone-400 uppercase tracking-widest">Date</th>
                              <th className="px-6 py-4 text-[10px] font-mono text-stone-400 uppercase tracking-widest">Description</th>
                              <th className="px-6 py-4 text-[10px] font-mono text-stone-400 uppercase tracking-widest text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-stone-100">
                            {transactions.filter(tx => tx.linkedPoId === selectedFundedPO.id).map((tx, idx) => (
                              <tr key={idx} className="text-xs">
                                <td className="px-6 py-4 font-mono text-stone-500">{tx.date}</td>
                                <td className="px-6 py-4 font-medium text-ink">{tx.description}</td>
                                <td className="px-6 py-4 text-right font-bold text-emerald-600">${tx.amount.toLocaleString()}</td>
                              </tr>
                            ))}
                            {transactions.filter(tx => tx.linkedPoId === selectedFundedPO.id).length === 0 && (
                              <tr>
                                <td colSpan={3} className="px-6 py-10 text-center text-stone-400 font-mono text-[10px] italic">
                                  No financial transactions recorded yet
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </div>

                  <div className="space-y-8">
                    <div className="bg-ink text-white p-8 rounded-[2.5rem] shadow-xl space-y-8">
                      <p className="mono-label !text-white/50">Asset Summary</p>
                      <div className="space-y-1">
                        <p className="text-4xl font-bold tracking-tight">${selectedFundedPO.amount.toLocaleString()}</p>
                        <p className="mono-label !text-white/50">Total Principal</p>
                      </div>
                      <div className="h-px bg-white/10" />
                      <div className="space-y-1">
                        <p className="text-2xl font-bold tracking-tight text-emerald-400">
                          ${transactions.filter(tx => tx.linkedPoId === selectedFundedPO.id).reduce((acc, tx) => acc + tx.amount, 0).toLocaleString()}
                        </p>
                        <p className="mono-label !text-white/50">Total Repaid to Date</p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-2xl font-bold tracking-tight text-amber-400">
                          {(() => {
                            const originalPo = pos.find(p => p.reissuedPoId === selectedFundedPO.id);
                            const res = reservations.find(r => (r.poId === selectedFundedPO.id || (originalPo && r.poId === originalPo.id)) && r.status === 'Accepted');
                            const totalDue = selectedFundedPO.amount * (1 + (res?.paymentOption.interest || 0) / 100);
                            const totalPaid = transactions.filter(tx => tx.linkedPoId === selectedFundedPO.id).reduce((acc, tx) => acc + tx.amount, 0);
                            return `$${Math.max(0, totalDue - totalPaid).toLocaleString()}`;
                          })()}
                        </p>
                        <p className="mono-label !text-white/50">Remaining Balance (incl. Markup)</p>
                      </div>
                    </div>

                    <div className="premium-card p-8 space-y-6">
                      <h4 className="mono-label">Quick Actions</h4>
                      <button 
                        onClick={() => {
                          setPaymentForm({ poId: selectedFundedPO.id, amount: 0, type: 'Principal' });
                          setAdminSubTab('finance');
                          setSelectedFundedPO(null);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="w-full py-4 bg-stone-50 border border-stone-200 rounded-2xl text-xs font-bold uppercase tracking-widest hover:bg-stone-100 transition-all flex items-center justify-center gap-3"
                      >
                        <CreditCard size={16} /> Record Payment
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Capital Modal */}
      <AnimatePresence>
        {capitalModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setCapitalModalOpen(false)}
              className="fixed inset-0 bg-ink/40 backdrop-blur-md"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="w-full max-w-lg bg-white rounded-[3rem] shadow-2xl relative z-10 overflow-hidden border border-stone-200/60"
            >
              <div className="p-12">
                <h3 className="display-text mb-3">Inject <span className="italic font-serif">Capital</span></h3>
                <p className="mono-label !text-zinc-400 mb-10">Increase institutional liquidity for PO reservation facilities.</p>
                
                <div className="space-y-8">
                  <div className="space-y-3">
                    <label className="mono-label ml-1">Deposit Allocation (USD)</label>
                    <div className="relative">
                      <span className="absolute left-6 top-1/2 -translate-y-1/2 text-zinc-400 text-sm font-mono">$</span>
                      <input 
                        type="number" 
                        placeholder="50,000"
                        className="w-full bg-stone-50 border border-stone-200 rounded-2xl py-5 pl-12 pr-6 text-lg font-light tracking-tight focus:outline-none focus:border-ink focus:ring-4 focus:ring-ink/5 transition-all"
                        id="capital-amount"
                      />
                    </div>
                  </div>
                  
                  <div className="space-y-4">
                    <button 
                      onClick={() => {
                        const val = (document.getElementById('capital-amount') as HTMLInputElement).value;
                        if (val) handleAddCapital(Number(val));
                      }}
                      className="btn-primary w-full py-5 shadow-xl shadow-ink/10"
                    >
                      Confirm Capital Injection
                    </button>
                    <button 
                      onClick={() => setCapitalModalOpen(false)}
                      className="btn-ghost w-full py-3"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
