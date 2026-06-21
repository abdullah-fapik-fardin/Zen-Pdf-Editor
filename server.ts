import express from "express";
import { GoogleGenAI } from "@google/genai";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));

app.post("/api/process-document", async (req, res) => {
  try {
    const { documentText, pdfData, mode, instructions } = req.body;

    if (!documentText && !pdfData) {
      return res.status(400).json({ error: "Missing document content or PDF file" });
    }
    if (!mode) {
      return res.status(400).json({ error: "Missing mode" });
    }

    // Simulate analysis delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    let mockResult = "";

    switch (mode) {
      case "CONTENT_EDIT":
        mockResult = "Revised Document Content:\n\n[This is a simulated edit of the provided document text.]\n\nThe original content has been reviewed and typos/grammar have been corrected based on standard business communication guidelines.";
        if (instructions) mockResult += `\n\nApplied Instructions: ${instructions}`;
        break;
      case "DATA_EXTRACTION":
        mockResult = '{\n  "status": "success",\n  "extracted_data": {\n    "document_type": "Invoice / Agreement",\n    "date_found": "2024-01-14",\n    "parties": ["NexusCorp Dynamics", "Horizon Ventures Group"],\n    "key_figures": ["$10,000", "30 days"]\n  }\n}';
        break;
      case "REDACTION_IDENTIFIER":
        mockResult = '[\n  "NexusCorp Dynamics",\n  "Horizon Ventures Group",\n  "January 14, 2024",\n  "123-45-6789"\n]';
        break;
      case "STRUCTURE_REFORMAT":
        mockResult = "# Master Services Agreement\n\n## 1. Parties\n- **Company:** NexusCorp Dynamics\n- **Client:** Horizon Ventures Group\n\n## 2. Terms\n- Standard confidentiality applies.\n- Liability capped at 12 months.\n\n## 3. Signatures\n- Unsigned";
        break;
      case "SMART_SUMMARIZATION":
        mockResult = "EXECUTIVE SUMMARY:\n\n- FINANCIALS: Net 30 terms with 1.5% late fee.\n- RISKS: Mutual indemnification clause included. Liability is capped.\n- ACTION ITEMS: Needs signature by February 14, 2024.";
        break;
      default:
        mockResult = "Processed successfully.";
    }

    res.json({ result: mockResult });
  } catch (error: any) {
    console.error("Local Error:", error);
    res.status(500).json({ error: "Failed to process document locally." });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
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
