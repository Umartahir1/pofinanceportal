import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, deleteDoc, doc } from 'firebase/firestore';

const firebaseConfig = {
  projectId: "gen-lang-client-0488258649",
  appId: "1:925425403229:web:f709655a912820c4ac94b4",
  apiKey: "AIzaSyCR2a-ywxsbiARG5zYIktbeGnkoy8Sf9dI",
  authDomain: "gen-lang-client-0488258649.firebaseapp.com",
  storageBucket: "gen-lang-client-0488258649.firebasestorage.app",
  messagingSenderId: "925425403229",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app, 'ai-studio-74430e2e-8fb2-48db-bc5c-f61820f77b24');

const q = query(collection(db, 'purchaseOrders'), where('poNumber', '==', 'PO010298'));
const snap = await getDocs(q);

if (snap.empty) {
  console.log('No PO found with poNumber PO010298');
  process.exit(0);
}

for (const d of snap.docs) {
  console.log(`Deleting doc: ${d.id} (${d.data().poNumber})`);
  await deleteDoc(doc(db, 'purchaseOrders', d.id));
  console.log('Deleted.');
}
process.exit(0);
