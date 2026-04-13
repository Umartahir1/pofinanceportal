import { initializeApp } from "firebase/app";
import { getFirestore, doc, deleteDoc } from "firebase/firestore";
import fs from "fs";

const config = JSON.parse(fs.readFileSync("firebase-applet-config.json", "utf-8"));
const app = initializeApp(config);
const db = getFirestore(app, config.firestoreDatabaseId);

async function fix() {
  console.log("Deleting PO010297");
  await deleteDoc(doc(db, "purchaseOrders", "PO010297"));
  console.log("Done");
  process.exit(0);
}
fix();
