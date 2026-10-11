import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as xlsx from 'xlsx';
import { PrismaClient } from '@prisma/client';
import { runWorkspaceVerification } from './verificationEngine';
import { composeCombinedDocument } from './composer';

const prisma = new PrismaClient();

export async function createDemoWorkspace(userId: string) {
  // 1. Ensure uploads/demo directory exists
  const demoDir = path.resolve(process.cwd(), 'uploads', 'demo');
  if (!fs.existsSync(demoDir)) {
    fs.mkdirSync(demoDir, { recursive: true });
  }

  // 2. Create the workspace
  const workspaceName = '🚀 Project Orion — HackFest Demonstration [DEMO DATA]';
  let workspace = await prisma.workspace.findFirst({
    where: { userId, name: workspaceName }
  });

  if (workspace) {
    // Delete existing to allow clean re-load
    await prisma.workspace.delete({ where: { id: workspace.id } });
  }

  workspace = await prisma.workspace.create({
    data: {
      name: workspaceName,
      description: 'Pre-configured HackFest demo with cross-source agreements, duplicate claims, budget contradiction ($4.2M vs $5.8M), unsupported rumor, and extraction limitation.',
      userId,
      isDemo: true
    }
  });

  // 3. Create Demo File 1: Project_Orion_Charter.txt
  const file1Path = path.join(demoDir, 'Project_Orion_Charter.txt');
  const file1Content = `========================================================
PROJECT ORION: SYSTEM SPECIFICATION & EXECUTIVE CHARTER
Classification: Internal
Date: January 15, 2026
========================================================

1. Scope and Leadership
Project Orion is the enterprise next-generation verifiable data engine.
Lead Director is Dr. Elena Vance.
The primary engineering facility is located in Zurich Research Park.

2. Financial Parameters & Budget
The approved total budget is $4.2M allocated across all phases.
Phase 1 initial drawdown is capped at $800,000.

3. Operational Timeline
The target launch deadline is Q4 2026.
Alpha milestone completion date is June 30, 2026.

4. Operational Governance
Project status is Active.
Security clearance required is Level 4.
Selected vendor is NovaCore Systems.
`;
  fs.writeFileSync(file1Path, file1Content, 'utf-8');
  const hash1 = crypto.createHash('sha256').update(file1Content).digest('hex');

  // 4. Create Demo File 2: Financial_Audit_Q3.xlsx
  const file2Path = path.join(demoDir, 'Financial_Audit_Q3.xlsx');
  const wb = xlsx.utils.book_new();
  const wsData = [
    ['Entity', 'Attribute', 'Recorded Value', 'Audit Notes'],
    ['Project Orion', 'budget', '$5.8M', 'Revised fiscal allocation according to Q3 Comptroller Ledger (Discrepancy)'],
    ['Project Orion', 'lead_director', 'Dr. Elena Vance', 'Executive signatory verified'],
    ['Project Orion', 'expenditure', '$1.2M', 'Cumulative verified expenditures through September 2026'],
    ['Project Orion', 'status', 'Active', 'Operational and funded']
  ];
  const ws = xlsx.utils.aoa_to_sheet(wsData);
  xlsx.utils.book_append_sheet(wb, ws, 'Audit_Overview');
  xlsx.writeFile(wb, file2Path);
  const hash2 = crypto.createHash('sha256').update(fs.readFileSync(file2Path)).digest('hex');

  // 5. Create Demo File 3: Engineering_Milestones_V2.md (Duplicate statements and confirmation)
  const file3Path = path.join(demoDir, 'Engineering_Milestones_V2.md');
  const file3Content = `# Engineering Milestones Report — Project Orion
Classification: Internal

## Executive Summary
This memo reconfirms the active timeline and core governance of Project Orion.

- Lead Director is Dr. Elena Vance.
- The scheduled launch deadline is Q4 2026.
- Hardware partner vendor is NovaCore Systems.
- Project status is Active.
`;
  fs.writeFileSync(file3Path, file3Content, 'utf-8');
  const hash3 = crypto.createHash('sha256').update(file3Content).digest('hex');

  // 6. Create Demo File 4: Anonymous_Vendor_Memo.txt (Unsupported Claim)
  const file4Path = path.join(demoDir, 'Anonymous_Vendor_Memo.txt');
  const file4Content = `MEMORANDUM [UNVERIFIED SOURCE / ANONYMOUS]
Subject: Secondary Subcontractor Speculation

An unverified rumor indicates that Project Orion vendor is ZetaCorp Offshore, with alleged unauthorized subcontracts.
Note: No supporting documentation or procurement purchase order accompanies this claim.
`;
  fs.writeFileSync(file4Path, file4Content, 'utf-8');
  const hash4 = crypto.createHash('sha256').update(file4Content).digest('hex');

  // 7. Create Demo File 5: Scanned_Calibration_Receipt.png (Extraction Limitation)
  // We write a sample file representing a degraded scan
  const file5Path = path.join(demoDir, 'Scanned_Calibration_Receipt.png');
  // 1x1 dummy PNG bytes or small image
  const dummyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  fs.writeFileSync(file5Path, dummyPng);
  const hash5 = crypto.createHash('sha256').update(dummyPng).digest('hex');

  // 8. Register Documents in DB
  const doc1 = await prisma.document.create({
    data: {
      workspaceId: workspace.id,
      title: 'Project_Orion_Charter.txt',
      originalName: 'Project_Orion_Charter.txt',
      mimeType: 'text/plain',
      size: Buffer.byteLength(file1Content),
      fileHash: hash1,
      storagePath: file1Path,
      classification: 'Internal',
      status: 'Pending',
      extractionStatus: 'Pending',
      userId
    }
  });

  const doc2 = await prisma.document.create({
    data: {
      workspaceId: workspace.id,
      title: 'Financial_Audit_Q3.xlsx',
      originalName: 'Financial_Audit_Q3.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      size: fs.statSync(file2Path).size,
      fileHash: hash2,
      storagePath: file2Path,
      classification: 'Restricted',
      status: 'Pending',
      extractionStatus: 'Pending',
      userId
    }
  });

  const doc3 = await prisma.document.create({
    data: {
      workspaceId: workspace.id,
      title: 'Engineering_Milestones_V2.md',
      originalName: 'Engineering_Milestones_V2.md',
      mimeType: 'text/markdown',
      size: Buffer.byteLength(file3Content),
      fileHash: hash3,
      storagePath: file3Path,
      classification: 'Internal',
      status: 'Pending',
      extractionStatus: 'Pending',
      userId
    }
  });

  const doc4 = await prisma.document.create({
    data: {
      workspaceId: workspace.id,
      title: 'Anonymous_Vendor_Memo.txt',
      originalName: 'Anonymous_Vendor_Memo.txt',
      mimeType: 'text/plain',
      size: Buffer.byteLength(file4Content),
      fileHash: hash4,
      storagePath: file4Path,
      classification: 'Internal',
      status: 'Pending',
      extractionStatus: 'Pending',
      userId
    }
  });

  const doc5 = await prisma.document.create({
    data: {
      workspaceId: workspace.id,
      title: 'Scanned_Calibration_Receipt.png',
      originalName: 'Scanned_Calibration_Receipt.png',
      mimeType: 'image/png',
      size: dummyPng.length,
      fileHash: hash5,
      storagePath: file5Path,
      classification: 'Internal',
      status: 'Failed',
      extractionStatus: 'Partial',
      limitationNotes: 'Degraded low-contrast image scan; automated OCR confidence below threshold (Requires Manual Review).',
      userId
    }
  });

  // 9. Run Verification Engine immediately on the demo documents!
  const stats = await runWorkspaceVerification(workspace.id, userId);

  // 10. Generate synthesized Combined Document
  const report = await composeCombinedDocument(workspace.id, userId, 'Project Orion — Official HackFest Verified Synthesis');

  return {
    workspace,
    stats,
    reportId: report.id
  };
}
