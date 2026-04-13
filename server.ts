import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cookieSession from "cookie-session";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getAcumaticaConfig() {
  return {
    baseUrl: (process.env.ACUMATICA_BASE_URL || "https://svj1llc.acumatica.com").trim(),
    acumaticaUser: (process.env.ACUMATICA_USERNAME || "").trim(),
    acumaticaPass: (process.env.ACUMATICA_PASSWORD || "").trim(),
    acumaticaCompany: (process.env.ACUMATICA_COMPANY || "").trim(),
  };
}

const sessionSecret = process.env.SESSION_SECRET || "default_secret";

// Helper for Acumatica actions (Login -> Action -> Logout)
async function withAcumatica<T>(action: (cookies: string) => Promise<T>): Promise<T> {
  const { baseUrl, acumaticaUser, acumaticaPass, acumaticaCompany } = getAcumaticaConfig();
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  
  if (!acumaticaUser || !acumaticaPass || !acumaticaCompany) {
    const missing = [
      !acumaticaUser ? "ACUMATICA_USERNAME" : null,
      !acumaticaPass ? "ACUMATICA_PASSWORD" : null,
      !acumaticaCompany ? "ACUMATICA_COMPANY" : null,
    ].filter(Boolean);
    throw new Error(`Acumatica service account credentials not configured. Missing: ${missing.join(", ")}`);
  }

  // 1. Login
  const loginRes = await fetch(`${normalizedBaseUrl}/entity/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: acumaticaUser, password: acumaticaPass, company: acumaticaCompany }),
  });

  if (!loginRes.ok) {
    const errorText = await loginRes.text();
    throw new Error(`Acumatica login failed: ${errorText || loginRes.statusText}`);
  }

  const setCookies = loginRes.headers.getSetCookie();
  const cookieString = setCookies.map(c => c.split(';')[0]).join('; ');

  try {
    // 2. Perform Action
    return await action(cookieString);
  } finally {
    // 3. Logout
    await fetch(`${normalizedBaseUrl}/entity/auth/logout`, {
      method: "POST",
      headers: { "Cookie": cookieString }
    }).catch(err => console.error("Acumatica logout error:", err));
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  const PURCHASE_ORDER_ACTIONS_BASE = "/entity/Default/25.200.001/PurchaseOrder";

  // Required for secure cookies behind a proxy
  app.set("trust proxy", 1);

  app.use(express.json());
  app.use(
    cookieSession({
      name: "session",
      keys: [sessionSecret],
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      secure: true,
      sameSite: "none",
      httpOnly: true,
    })
  );

  const callPurchaseOrderAction = async (
    normalizedBaseUrl: string,
    cookies: string,
    action: string,
    poNbr: string
  ) => {
    const url = `${normalizedBaseUrl}${PURCHASE_ORDER_ACTIONS_BASE}/${action}`;
    const headers = {
      "Cookie": cookies,
      "Accept": "application/json",
      "Content-Type": "application/json",
    };
    const payloads = [
      { entity: { OrderType: { value: "Normal" }, OrderNbr: { value: poNbr } } },
      { OrderType: { value: "Normal" }, OrderNbr: { value: poNbr } },
    ];

    const attempts: Array<{ status: number; body: string }> = [];

    for (const payload of payloads) {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const body = await response.text();

      if (response.ok) {
        console.log(`${action} ${poNbr}: ${response.status} ${body}`);
        return { ok: true, status: response.status, body };
      }

      attempts.push({ status: response.status, body });
    }

    const details = attempts
      .map((a, idx) => `attempt${idx + 1}: ${a.status} ${a.body}`)
      .join(" | ");

    return { ok: false, status: attempts[attempts.length - 1]?.status ?? 500, body: details };
  };

  // Acumatica Cookie-based Authentication Endpoints
  app.post("/api/acumatica/login", async (req, res) => {
    const { name, password, company } = req.body;
    const { baseUrl, acumaticaUser, acumaticaPass, acumaticaCompany } = getAcumaticaConfig();
    
    // Use environment variables if not provided in request body
    const finalName = name || acumaticaUser;
    const finalPassword = password || acumaticaPass;
    const finalCompany = company || acumaticaCompany;

    const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
    
    console.log(`Attempting Acumatica login for ${finalName} at ${normalizedBaseUrl}`);
    
    if (!finalName || !finalPassword || !finalCompany) {
      return res.status(400).json({ error: "Missing Acumatica credentials (name, password, or company)" });
    }

    try {
      const loginRes = await fetch(`${normalizedBaseUrl}/entity/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: finalName, password: finalPassword, company: finalCompany }),
      });

      if (!loginRes.ok) {
        const errorText = await loginRes.text();
        console.error("Acumatica login failed status:", loginRes.status, "error:", errorText);
        return res.status(loginRes.status).json({ error: errorText || "Login failed" });
      }

      // Extract cookies
      let cookieString = "";
      if (typeof loginRes.headers.getSetCookie === 'function') {
        const setCookies = loginRes.headers.getSetCookie();
        if (setCookies && setCookies.length > 0) {
          cookieString = setCookies.map(c => c.split(';')[0]).join('; ');
        }
      } else {
        // Fallback for older Node versions if needed
        const rawCookies = loginRes.headers.get("set-cookie");
        if (rawCookies) {
          cookieString = rawCookies;
        }
      }

      if (!cookieString) {
        console.error("No session cookies returned from Acumatica");
        return res.status(500).json({ error: "No session cookies returned from Acumatica" });
      }
      
      console.log("Acumatica login successful, cookies obtained");
      // Return cookies to client to bypass iframe session issues
      res.json({ success: true, cookies: cookieString });
    } catch (error) {
      console.error("Login error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error during login" });
    }
  });

  app.post("/api/vendor/signup", async (req, res) => {
    const { vendorName, contactName, email, address } = req.body;
    const { baseUrl } = getAcumaticaConfig();
    const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

    try {
      const result = await withAcumatica(async (cookieString) => {
        // Create Vendor
        const vendorPayload = {
          "VendorID": { "value": "<NEW>" },
          "VendorName": { "value": vendorName },
          "LegalName": { "value": vendorName },
          "VendorClass": { "value": "VENDOR" },
          "Status": { "value": "Active" },
          "CurrencyID": { "value": "USD" },
          "Terms": { "value": "NET30" },
          "PaymentMethod": { "value": "CHECK" },
          "PaymentBy": { "value": "Due Date" },
          "APAccount": { "value": "21000" },
          "LocationName": { "value": "Primary Location" },
          "F1099Vendor": { "value": false },
          "VendorIsTaxAgency": { "value": false },
          "ForeignEntity": { "value": false },
          "EnableCurrencyOverride": { "value": false },
          "EnableRateOverride": { "value": false },
          "ReceiptAction": { "value": "Accept but Warn" },
          "MaxReceipt": { "value": 100 },
          "MinReceipt": { "value": 0 },
          "SendOrdersbyEmail": { "value": true },
          "PrintOrders": { "value": false },
          "PaySeparately": { "value": false },
          "MainContact": {
            "Email": { "value": email },
            "Attention": { "value": contactName },
            "Address": {
              "AddressLine1": { "value": address }
            }
          }
        };

        const createRes = await fetch(`${normalizedBaseUrl}/entity/Default/25.200.001/Vendor`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Cookie": cookieString
          },
          body: JSON.stringify(vendorPayload),
        });

        if (!createRes.ok) {
          const errorText = await createRes.text();
          throw new Error(`Failed to create vendor in Acumatica: ${errorText}`);
        }

        const vendorData = await createRes.json();
        return { success: true, vendorId: vendorData.VendorID?.value };
      });

      res.json(result);
    } catch (error) {
      console.error("Vendor signup error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error during vendor signup" });
    }
  });

  app.put("/api/vendor/update", async (req, res) => {
    const { vendorId, vendorName, contactName, email, address } = req.body;
    const { baseUrl } = getAcumaticaConfig();
    const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

    if (!vendorId) {
      return res.status(400).json({ error: "Vendor ID is required for update" });
    }

    try {
      await withAcumatica(async (cookieString) => {
        const vendorPayload = {
          "VendorID": { "value": vendorId },
          "VendorName": { "value": vendorName },
          "LegalName": { "value": vendorName },
          "MainContact": {
            "Email": { "value": email },
            "Attention": { "value": contactName },
            "Address": {
              "AddressLine1": { "value": address }
            }
          }
        };

        const updateRes = await fetch(`${normalizedBaseUrl}/entity/Default/25.200.001/Vendor`, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Cookie": cookieString
          },
          body: JSON.stringify(vendorPayload),
        });

        if (!updateRes.ok) {
          const errorText = await updateRes.text();
          throw new Error(`Failed to update vendor in Acumatica: ${errorText}`);
        }
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Vendor update error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error during vendor update" });
    }
  });

  app.get("/api/acumatica/sync", async (req, res) => {
    const { baseUrl } = getAcumaticaConfig();
    const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
    try {
      const result = await withAcumatica(async (cookieString) => {
        // Fetch POs
        const poQueryParams = new URLSearchParams({
          "$filter": "Branch eq 'PACK' and (Status eq 'Open' or Status eq 'On Hold' or Status eq 'Pending Email')",
          "$expand": "Details"
        });
        const poUrl = `${normalizedBaseUrl}/entity/Default/25.200.001/PurchaseOrder?${poQueryParams.toString()}`;
        const poRes = await fetch(poUrl, {
          method: "GET",
          headers: { "Cookie": cookieString, "Accept": "application/json" },
        });

        if (!poRes.ok) {
          const errorText = await poRes.text();
          throw new Error(errorText || "Failed to fetch purchase orders");
        }
        const pos = await poRes.json();

        // Fetch Vendors to get names
        const vendorUrl = `${normalizedBaseUrl}/entity/Default/25.200.001/Vendor?$select=VendorID,VendorName`;
        const vendorRes = await fetch(vendorUrl, {
          method: "GET",
          headers: { "Cookie": cookieString, "Accept": "application/json" },
        });

        let vendors = [];
        if (vendorRes.ok) {
          vendors = await vendorRes.json();
        }

        return { pos, vendors };
      });

      res.json(result);
    } catch (error) {
      console.error("Sync error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error during sync" });
    }
  });

  app.get("/api/acumatica/vendor/:vendorId", async (req, res) => {
    const { baseUrl } = getAcumaticaConfig();
    const cookies = req.headers["x-acumatica-cookies"] as string;
    const { vendorId } = req.params;
    const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

    if (!cookies) {
      return res.status(401).json({ error: "Not logged in to Acumatica" });
    }

    try {
      const targetUrl = `${normalizedBaseUrl}/entity/Default/25.200.001/Vendor/${vendorId}?$expand=MainContact`;
      const apiRes = await fetch(targetUrl, {
        method: "GET",
        headers: {
          "Cookie": cookies,
          "Accept": "application/json",
        },
      });

      if (!apiRes.ok) {
        const errorText = await apiRes.text();
        return res.status(apiRes.status).json({ error: errorText || "Failed to fetch vendor" });
      }

      const data = await apiRes.json();
      res.json(data);
    } catch (error) {
      console.error("Vendor fetch error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
    }
  });

  app.get("/api/acumatica/purchase-receipts", async (req, res) => {
    const { baseUrl } = getAcumaticaConfig();
    // Check for cookies in header first (bypass iframe issues)
    const cookies = req.headers["x-acumatica-cookies"] as string;
    const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
    
    if (!cookies) {
      return res.status(401).json({ error: "Not logged in to Acumatica (Missing session cookies)" });
    }

    try {
      const queryParams = new URLSearchParams({
        "$filter": "Branch eq 'PACK' and Status eq 'Open'",
        "$expand": "Details"
      });
      
      const targetUrl = `${normalizedBaseUrl}/entity/Default/25.200.001/PurchaseReceipt?${queryParams.toString()}`;
      
      const apiRes = await fetch(targetUrl, {
        method: "GET",
        headers: {
          "Cookie": cookies,
          "Accept": "application/json",
        },
      });

      if (!apiRes.ok) {
        const errorText = await apiRes.text();
        return res.status(apiRes.status).json({ error: errorText || "Failed to fetch receipts" });
      }

      const data = await apiRes.json();
      res.json(data);
    } catch (error) {
      console.error("API call error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
    }
  });

  app.post("/api/acumatica/po/reissue", express.json(), async (req, res) => {
    const { poNumber, newVendorId, markupPercent, lenderName } = req.body;
    const { baseUrl } = getAcumaticaConfig();
    const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

    try {
      const result = await withAcumatica(async (cookies) => {
        // 1. Fetch original PO to get details, including Files and VendorRef
        const getPoUrl = `${normalizedBaseUrl}/entity/Default/25.200.001/PurchaseOrder/Normal/${poNumber}?$expand=Details,Files`;
        const poRes = await fetch(getPoUrl, {
          method: "GET",
          headers: { "Cookie": cookies, "Accept": "application/json" },
        });

        if (!poRes.ok) {
          throw new Error(`Failed to fetch original PO: ${await poRes.text()}`);
        }

        const originalPo = await poRes.json();
        const vendorRef = originalPo.VendorRef?.value || "";
        const originalDescription = originalPo.Description?.value || "";
        const originalBranch = originalPo.Branch?.value || "PACK";
        
        // 2. Cancel original PO (RemoveHold first, then CancelOrder — non-fatal if PO has receipts/bills)
        await callPurchaseOrderAction(normalizedBaseUrl, cookies, "RemoveHold", poNumber);
        const cancelOriginal = await callPurchaseOrderAction(normalizedBaseUrl, cookies, "CancelOrder", poNumber);
        const cancelWarning = cancelOriginal.ok ? null
          : `Note: Could not cancel original PO ${poNumber} in Acumatica (${cancelOriginal.body.includes("disabled") ? "PO has receipts or bills — cancel manually in Acumatica" : cancelOriginal.body})`;

        // 3. Create new PO with markup, new vendor, and copied VendorRef
        const createUrl = `${normalizedBaseUrl}/entity/Default/25.200.001/PurchaseOrder`;
        const markup = 1 + (markupPercent / 100);
        
        const newPoData = {
          OrderType: { value: "Normal" },
          Branch: { value: originalBranch },
          VendorID: { value: newVendorId },
          VendorRef: { value: vendorRef },
          Description: { value: `Finance Portal - ${originalDescription}`.substring(0, 255) },
          Details: originalPo.Details.map((item: any) => ({
            InventoryID: { value: item.InventoryID.value },
            OrderQty: { value: item.OrderQty.value },
            UnitCost: { value: item.UnitCost.value * markup },
            UOM: { value: item.UOM.value },
            WarehouseID: { value: item.WarehouseID.value }
          }))
        };

        const createRes = await fetch(createUrl, {
          method: "PUT",
          headers: { 
            "Cookie": cookies, 
            "Accept": "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify(newPoData)
        });

        if (!createRes.ok) {
          throw new Error(`Failed to create new PO: ${await createRes.text()}`);
        }

        const createdPo = await createRes.json();
        const newPoNbr = createdPo.OrderNbr.value;

        // 4. Try to Remove Hold
        try {
          await callPurchaseOrderAction(normalizedBaseUrl, cookies, "RemoveHold", newPoNbr);
        } catch (err) {
          console.error(`Failed to remove hold for PO ${newPoNbr}:`, err);
        }

        // 5. Handle Attachments (Files)
        if (originalPo.Files && originalPo.Files.length > 0) {
          console.log(`Original PO ${poNumber} had ${originalPo.Files.length} attachments. Copying to new PO ${newPoNbr}...`);
          
          for (const file of originalPo.Files) {
            try {
              // Download file content from original PO
              // file.href is usually relative to the site root
              const fileUrl = `${normalizedBaseUrl}${file.href}`;
              const fileRes = await fetch(fileUrl, {
                method: "GET",
                headers: { "Cookie": cookies }
              });
              
              if (!fileRes.ok) {
                console.error(`Failed to download attachment ${file.name} from ${fileUrl}`);
                continue;
              }

              const arrayBuffer = await fileRes.arrayBuffer();
              
              // Upload to new PO
              // Endpoint format: .../PurchaseOrder/Normal/{OrderNbr}/files/{FileName}
              const uploadUrl = `${normalizedBaseUrl}/entity/Default/25.200.001/PurchaseOrder/Normal/${newPoNbr}/files/${file.name}`;
              const uploadRes = await fetch(uploadUrl, {
                method: "PUT",
                headers: { 
                  "Cookie": cookies,
                  "Content-Type": "application/octet-stream"
                },
                body: Buffer.from(arrayBuffer)
              });

              if (uploadRes.ok) {
                console.log(`Successfully copied attachment: ${file.name}`);
              } else {
                console.error(`Failed to upload attachment ${file.name} to ${uploadUrl}: ${await uploadRes.text()}`);
              }
            } catch (fileErr) {
              console.error(`Error processing attachment ${file.name}:`, fileErr);
            }
          }
        }

        return {
          message: "PO reissued successfully",
          originalPo: poNumber,
          newPo: newPoNbr,
          vendorRef: vendorRef,
          cancelWarning: cancelWarning
        };
      });

      res.json(result);
    } catch (error) {
      console.error("PO Reissue error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
    }
  });

  // One-shot cancel endpoint — for manually cancelling a PO in Acumatica
  app.post("/api/acumatica/po/cancel-only", express.json(), async (req, res) => {
    const { poNumber } = req.body;
    if (!poNumber) return res.status(400).json({ error: "poNumber is required" });
    const { baseUrl } = getAcumaticaConfig();
    const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
    try {
      const result = await withAcumatica(async (cookies) => {
        await callPurchaseOrderAction(normalizedBaseUrl, cookies, "RemoveHold", poNumber);
        const r = await callPurchaseOrderAction(normalizedBaseUrl, cookies, "CancelOrder", poNumber);
        return { ok: r.ok, status: r.status, body: r.body };
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
    }
  });

  app.post("/api/acumatica/po/rollback", express.json(), async (req, res) => {
    const { reissuedPoNumber, originalPoNumber } = req.body;
    if (!originalPoNumber) return res.status(400).json({ error: "originalPoNumber is required" });
    const { baseUrl } = getAcumaticaConfig();
    const normalizedBaseUrl = baseUrl.replace(/\/$/, "");

    const isBenignRollbackFailure = (action: string, responseText: string) => {
      const text = responseText.toLowerCase();
      if (action === "CancelOrder") {
        return (
          text.includes("already cancelled") ||
          text.includes("already canceled") ||
          text.includes("cancel order button is disabled") ||
          text.includes("pxactiondisabledexception")
        );
      }
      if (action === "ReopenOrder") {
        return text.includes("already open") || text.includes("reopen order button is disabled");
      }
      return false;
    };

    try {
      const result = await withAcumatica(async (cookies) => {
        const log: string[] = [];

        // 1. Cancel the reissued PO (RemoveHold first in case it's On Hold)
        if (reissuedPoNumber) {
          const holdR = await callPurchaseOrderAction(normalizedBaseUrl, cookies, "RemoveHold", reissuedPoNumber);
          log.push(`RemoveHold ${reissuedPoNumber}: ${holdR.ok ? "success" : `warning (${holdR.status})`}`);
          const cancelR = await callPurchaseOrderAction(normalizedBaseUrl, cookies, "CancelOrder", reissuedPoNumber);
          if (!cancelR.ok && !isBenignRollbackFailure("CancelOrder", cancelR.body)) {
            throw new Error(`Rollback failed cancelling reissued PO ${reissuedPoNumber}: ${cancelR.body}`);
          }
          log.push(`CancelOrder ${reissuedPoNumber}: ${cancelR.ok ? "success" : "not cancellable in current status"}`);
        }

        // 2. Reopen the original PO (hard requirement unless already open)
        const r = await callPurchaseOrderAction(normalizedBaseUrl, cookies, "ReopenOrder", originalPoNumber);
        if (!r.ok && !isBenignRollbackFailure("ReopenOrder", r.body)) {
          throw new Error(`Rollback failed reopening original PO ${originalPoNumber}: ${r.body}`);
        }
        log.push(`ReopenOrder ${originalPoNumber}: ${r.ok ? "success" : "already open"}`);

        console.log("Rollback log:", log);
        return { message: "Rollback complete", log, reissuedPoNumber, originalPoNumber };
      });
      res.json(result);
    } catch (error) {
      console.error("PO Rollback error:", error);
      const errorMessage = error instanceof Error ? error.message : "Internal Server Error";
      const normalized = errorMessage.toLowerCase();

      const cancelDisabled =
        normalized.includes("rollback failed cancelling reissued po") &&
        (normalized.includes("cancel order button is disabled") || normalized.includes("pxactiondisabledexception"));
      const reopenDisabled =
        normalized.includes("rollback failed reopening original po") &&
        (normalized.includes("reopen order button is disabled") || normalized.includes("pxactiondisabledexception"));

      if (cancelDisabled || reopenDisabled) {
        const actionText = reissuedPoNumber
          ? `Action required in Acumatica: open PO ${reissuedPoNumber} and click Cancel Order, then open PO ${originalPoNumber} and click Reopen Order. After that, run Rollback again in the portal.`
          : `Action required in Acumatica: open PO ${originalPoNumber} and click Reopen Order. After that, run Rollback again in the portal.`;
        return res.status(409).json({ error: actionText });
      }

      res.status(500).json({ error: errorMessage });
    }
  });

  // Only use Vite middleware when explicitly running in local development.
  // In hosted environments (where NODE_ENV can be unset), default to production static serving.
  const isDevelopment = process.env.NODE_ENV === "development";

  if (isDevelopment) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
