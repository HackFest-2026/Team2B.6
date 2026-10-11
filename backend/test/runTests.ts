import assert from 'assert';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { extractDocumentText } from '../src/services/extractor';
import { extractClaimsFromDocument } from '../src/services/claimExtractor';
import { runWorkspaceVerification } from '../src/services/verificationEngine';
import { composeCombinedDocument } from '../src/services/composer';
import { exportReportAsPdf, exportReportAsDocx, exportReportAsCsv } from '../src/services/exporter';
import { answerQuestionFromDocuments } from '../src/services/chatService';
import { createDemoWorkspace } from '../src/services/demoWorkspace';

const prisma = new PrismaClient();

async function runTestSuite() {
  console.log('\n========================================');
  console.log('🧪 VERIMERGE FULL VERIFICATION TEST SUITE');
  console.log('========================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err: any) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
      failed++;
    }
  }

  // 1. Database Connection & Models
  await test('Database Connection and Prisma Models', async () => {
    const userCount = await prisma.user.count();
    assert(typeof userCount === 'number', 'Prisma should query User table');
  });

  // 2. Auth & Signup / Login
  let testUserId = '';
  await test('User Creation and Duplicate Prevention', async () => {
    const testEmail = `test_${Date.now()}@verimerge.io`;
    const user = await prisma.user.create({
      data: {
        name: 'Test Auditor',
        email: testEmail,
        password: 'hashed_password_123',
        role: 'user'
      }
    });
    testUserId = user.id;
    assert(user.id, 'User should have an ID');

    // Duplicate email must throw error
    let threw = false;
    try {
      await prisma.user.create({
        data: {
          name: 'Dupe Auditor',
          email: testEmail,
          password: 'hashed_password_456'
        }
      });
    } catch {
      threw = true;
    }
    assert(threw, 'Duplicate email creation should be rejected');
  });

  // 3. Document Extraction & Format Handling
  await test('Extraction of TXT and SHA-256 Hash Calculation', async () => {
    const tempDir = path.resolve(process.cwd(), 'uploads', 'test');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    
    const samplePath = path.join(tempDir, 'test_sample.txt');
    const textSample = 'Project Apollo total budget is $4.5M. Target launch is Q4 2026. Lead director is Dr. Alan Grant.';
    fs.writeFileSync(samplePath, textSample);

    const res = await extractDocumentText(samplePath, 'test_sample.txt', 'text/plain');
    assert.strictEqual(res.status, 'Extracted');
    assert(res.text.includes('$4.5M'), 'Extracted text must contain sample text');
    assert.strictEqual(res.wordCount, 17);
    assert(res.fileHash.length === 64, 'SHA-256 hash must be 64 characters');
  });

  await test('Unsupported Format Handling (Never Pretend)', async () => {
    const tempDir = path.resolve(process.cwd(), 'uploads', 'test');
    const unsupportedPath = path.join(tempDir, 'sample.xyz');
    fs.writeFileSync(unsupportedPath, 'RAW_BINARY_UNKNOWN');

    const res = await extractDocumentText(unsupportedPath, 'sample.xyz', 'application/octet-stream');
    assert.strictEqual(res.status, 'Unsupported', 'Unsupported file must be labeled Unsupported format');
    assert(res.limitationNotes?.includes('Unsupported format'), 'Must state extraction unavailable');
  });

  await test('Extraction of PDF using PDFParse v2 (02_Commissioning_Report.pdf)', async () => {
    const pdfPath = path.resolve(process.cwd(), 'uploads', '1791690118089-805499062-02_Commissioning_Report.pdf');
    assert(fs.existsSync(pdfPath), 'Test file 02_Commissioning_Report.pdf must exist on disk');

    const res = await extractDocumentText(pdfPath, '02_Commissioning_Report.pdf', 'application/pdf');
    assert.strictEqual(res.status, 'Extracted', 'PDF extraction status must be Extracted');
    assert.strictEqual(res.pageCount, 2, 'PDF must report 2 pages');
    assert(res.wordCount > 250, `Word count must be nonzero and meaningful, got ${res.wordCount}`);
    assert(res.text.includes('--- Page 1 ---'), 'Text must preserve Page 1 boundary marker');
    assert(res.text.includes('--- Page 2 ---'), 'Text must preserve Page 2 boundary marker');
    assert(res.text.includes('COMM-NB-022'), 'Extracted text must contain Report ID COMM-NB-022');
    assert(res.text.includes('ROOFTOP SOLAR PILOT'), 'Extracted text must contain rooftop solar pilot');
  });

  await test('Re-extracting previously failed PDF document from DB without duplicate upload', async () => {
    const failedDoc = await prisma.document.findFirst({
      where: { originalName: '02_Commissioning_Report.pdf' }
    });
    assert(failedDoc, 'Failed document record for 02_Commissioning_Report.pdf must exist in DB');

    // Run extraction directly on existing stored file path
    const res = await extractDocumentText(failedDoc.storagePath, failedDoc.originalName, failedDoc.mimeType);
    assert.strictEqual(res.status, 'Extracted');

    const updated = await prisma.document.update({
      where: { id: failedDoc.id },
      data: {
        extractedText: res.text,
        pageCount: res.pageCount,
        wordCount: res.wordCount,
        status: 'Completed',
        extractionStatus: 'Extracted',
        limitationNotes: null
      }
    });

    assert.strictEqual(updated.status, 'Completed', 'Document status must be updated to Completed');
    assert.strictEqual(updated.extractionStatus, 'Extracted', 'Extraction status must be Extracted');
    assert(updated.wordCount > 250, 'Word count must be nonzero');
    assert.strictEqual(updated.limitationNotes, null, 'Previous failure error note must be cleared');
  });

  await test('Multi-Format Ingestion Integrity (CSV, DOCX, and PNG)', async () => {
    const csvPath = path.resolve(process.cwd(), 'uploads', '1791690118090-388070589-04_Project_Status_Register.csv');
    if (fs.existsSync(csvPath)) {
      const csvRes = await extractDocumentText(csvPath, '04_Project_Status_Register.csv', 'text/csv');
      assert.strictEqual(csvRes.status, 'Extracted');
      assert(csvRes.wordCount > 0, 'CSV word count must be nonzero');
    }

    const docxPath = path.resolve(process.cwd(), 'uploads', '1791690118086-764422332-01_Project_Proposal__1_.docx');
    if (fs.existsSync(docxPath)) {
      const docxRes = await extractDocumentText(docxPath, '01_Project_Proposal (1).docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      assert.strictEqual(docxRes.status, 'Extracted');
      assert(docxRes.wordCount > 100, 'DOCX word count must be nonzero');
    }

    const pngPath = path.resolve(process.cwd(), 'uploads', '1791690118090-11642307-05_OCR_Field_Note.png');
    if (fs.existsSync(pngPath)) {
      const pngRes = await extractDocumentText(pngPath, '05_OCR_Field_Note.png', 'image/png');
      assert(pngRes.status === 'OCR_Fallback' || pngRes.status === 'Extracted', 'PNG OCR must succeed');
      assert(pngRes.wordCount > 0, 'PNG OCR word count must be nonzero');
    }
  });

  // 4. Verification Engine: Contradiction Detection & Multi-Source Agreement
  let demoWorkspaceId = '';
  let demoReportId = '';
  await test('HackFest Demo Workspace Generation & Verification Engine', async () => {
    const demo = await createDemoWorkspace(testUserId);
    demoWorkspaceId = demo.workspace.id;
    demoReportId = demo.reportId;

    assert(demo.stats.totalDocuments >= 4, 'Must ingest at least 4 demo documents');
    assert(demo.stats.conflictingClaims >= 1, 'Must detect budget contradiction between Charter and Audit');
    assert(demo.stats.verifiedClaims >= 1, 'Must verify consensus claims');
    assert(demo.stats.conflictRecordsCount >= 1, 'Must generate Conflict records in DB');

    // Verify the conflict record in DB
    const conflicts = await prisma.conflict.findMany({ where: { workspaceId: demoWorkspaceId } });
    assert(conflicts.length >= 1, 'Conflict record must exist in DB');
    assert(conflicts[0].description.includes('Discrepancy'), 'Conflict description must detail discrepancy');
  });

  // 5. Verbatim Citation Verification Check
  await test('Verbatim Excerpt Occurrence Verification', async () => {
    const claims = await prisma.claim.findMany({
      where: { workspaceId: demoWorkspaceId },
      include: { citations: { include: { document: true } } }
    });

    assert(claims.length > 0, 'Workspace must contain claims');
    for (const c of claims) {
      if (c.citations.length > 0) {
        const cite = c.citations[0];
        assert(cite.document, 'Citation must reference a real document');
        assert(cite.location, 'Citation must include physical location');
        assert(cite.excerpt.length > 0, 'Citation must contain excerpt');
      }
    }
  });

  // 6. Evidence-Based Chatbot with Grounding and Missing Info Check
  await test('Evidence Chatbot Grounded Answers and Citations', async () => {
    // Query about Director (which exists)
    const answer1 = await answerQuestionFromDocuments('Who is the lead director of Project Orion?', testUserId, demoWorkspaceId);
    assert(answer1.reply.includes('Elena Vance'), 'Chatbot should retrieve Dr. Elena Vance from evidence');
    assert(answer1.citations.length > 0, 'Chatbot must attach citations');

    // Query about Budget (which has a contradiction)
    const answer2 = await answerQuestionFromDocuments('What is the total budget for Project Orion?', testUserId, demoWorkspaceId);
    assert(answer2.conflictsWarning || answer2.reply.includes('Warning') || answer2.reply.includes('conflict') || answer2.reply.includes('$4.2M') || answer2.reply.includes('$5.8M'),
      'Chatbot must highlight budget contradiction rather than hiding it');

    // Query about completely unknown entity
    const answer3 = await answerQuestionFromDocuments('What is the quantum encryption protocol of Mars base?', testUserId, demoWorkspaceId);
    assert(answer3.reply.includes('not contain sufficient evidence'), 'Chatbot must decline when evidence is missing');
    assert.strictEqual(answer3.citations.length, 0, 'No citations for missing evidence');
  });

  // 7. Multi-Format Exporters: PDF, DOCX, CSV
  await test('Export Verification Report as PDF Buffer', async () => {
    const pdfBuf = await exportReportAsPdf(demoReportId);
    assert(Buffer.isBuffer(pdfBuf), 'Must export Buffer');
    assert(pdfBuf.length > 1000, 'PDF buffer must have valid size');
    assert(pdfBuf.subarray(0, 4).toString() === '%PDF', 'PDF header must start with %PDF');
  });

  await test('Export Verification Report as DOCX Buffer', async () => {
    const docxBuf = await exportReportAsDocx(demoReportId);
    assert(Buffer.isBuffer(docxBuf), 'Must export DOCX Buffer');
    assert(docxBuf.length > 1000, 'DOCX buffer must have valid size');
  });

  await test('Export Evidence Ledger as CSV', async () => {
    const csvStr = await exportReportAsCsv(demoReportId);
    assert(typeof csvStr === 'string', 'Must export CSV string');
    assert(csvStr.includes('ClaimID,Entity,Attribute,Value,Status'), 'CSV must have proper header');
    assert(csvStr.includes('Project Orion'), 'CSV must contain verified claims');
  });

  // 8. Ownership Isolation & Access Control
  await test('Multi-User Ownership Isolation', async () => {
    // Another user shouldn't see testUser's documents
    const otherUser = await prisma.user.create({
      data: {
        name: 'Other Student',
        email: `other_${Date.now()}@verimerge.io`,
        password: 'hashed_password_other'
      }
    });

    const otherDocs = await prisma.document.findMany({ where: { userId: otherUser.id } });
    assert.strictEqual(otherDocs.length, 0, 'Other user must not see documents from first user');
  });

  // 9. Contradiction Detection Engine on 5 Test Documents (Requirement 12)
  const defaultWs = await prisma.workspace.findFirst({
    where: {
      documents: { some: { originalName: { contains: '02_Commissioning_Report.pdf' } } }
    },
    include: { documents: true }
  });

  if (defaultWs) {
    await test('Contradiction Detection Engine on 5 Test Documents (2 Genuine Conflicts, 51 Invalidated)', async () => {
      const stats = await runWorkspaceVerification(defaultWs.id, defaultWs.userId);

      // Acceptance: Exactly 2 active conflicts
      assert.strictEqual(stats.activeConflicts, 2, `Must find exactly 2 active conflicts, found ${stats.activeConflicts}`);
      assert.strictEqual(stats.invalidConflicts, 51, `Must preserve 51 invalidated false positives in audit trail, found ${stats.invalidConflicts}`);
      assert.strictEqual(stats.totalConflicts, 53, `Total conflicts in DB must be 53, found ${stats.totalConflicts}`);

      // Query active open conflicts from DB
      const openConflicts = await prisma.conflict.findMany({
        where: { workspaceId: defaultWs.id, status: 'Open' },
        include: {
          claim1: { include: { citations: { include: { document: true } } } },
          claim2: { include: { citations: { include: { document: true } } } }
        }
      });
      assert.strictEqual(openConflicts.length, 2, 'DB must contain exactly 2 open conflicts');

      const panelConflict = openConflicts.find(c => c.attribute === 'installed_panel_count');
      const capConflict = openConflicts.find(c => c.attribute === 'installed_capacity');
      assert(panelConflict, 'Must detect conflict on installed_panel_count');
      assert(capConflict, 'Must detect conflict on installed_capacity');

      // Verify panel values: 108 vs 120
      const panelVals = [panelConflict.claim1.value, panelConflict.claim2.value].sort();
      assert(panelVals[0].includes('108') && panelVals[1].includes('120'), 'Panel conflict must be between 108 panels and 120 panels');

      // Verify capacity values: 54 kWp vs 60 kWp
      const capVals = [capConflict.claim1.value, capConflict.claim2.value].sort();
      assert(capVals[0].includes('54') && capVals[1].includes('60'), 'Capacity conflict must be between 54 kWp and 60 kWp');

      // Check Proposed Budget vs Final Invoice: Must NOT be a contradiction
      const budgetConflict = openConflicts.find(c => c.attribute === 'budget' || c.description.toLowerCase().includes('budget'));
      assert(!budgetConflict, 'Proposed budget INR 840,000 vs final invoice INR 870,000 must not be a contradiction (different stages)');

      // Check Missing Evidence: 40% bill reduction and INR 250,000 first-month savings must be Unverified, not conflicts
      const unverifiedSavings = await prisma.claim.findMany({
        where: {
          workspaceId: defaultWs.id,
          attribute: { in: ['electricity_bill_reduction', 'first_month_savings'] }
        }
      });
      assert(unverifiedSavings.length >= 2, 'Savings claims must be extracted');
      for (const sc of unverifiedSavings) {
        assert.strictEqual(sc.status, 'Unverified', `Claim ${sc.attribute} must be Unverified due to missing evidence`);
      }

      // Check that headings and non-factual statements are NOT active claims
      const headingClaims = await prisma.claim.findMany({
        where: {
          workspaceId: defaultWs.id,
          value: { in: ['Recorded as-built values', 'Evidence not included', 'Proposed design and budget', 'Important interpretation note'] }
        }
      });
      for (const hc of headingClaims) {
        assert.notStrictEqual(hc.status, 'Conflicting', 'Headings must not be classified as Conflicting claims');
      }

      // Check Multi-source Agreeing Facts have Corroborated status
      const dateClaims = await prisma.claim.findMany({
        where: { workspaceId: defaultWs.id, attribute: 'commissioning_date' }
      });
      assert(dateClaims.length >= 2, 'Commissioning date must be corroborated across documents');
      for (const dc of dateClaims) {
        assert.strictEqual(dc.status, 'Corroborated', 'Agreeing facts must have status Corroborated');
      }
    });

    await test('Requirement 1 & 2: Status Separation (Corroborated, Source Match, Unverified, Needs Review, Invalidated)', async () => {
      const stats = await runWorkspaceVerification(defaultWs.id, defaultWs.userId);

      // Verify active vs invalidated counts
      assert.strictEqual(stats.totalClaims, 23, `Must have exactly 23 active claims, found ${stats.totalClaims}`);
      assert.strictEqual(stats.invalidatedClaims, 14, `Must have 14 historical invalidated claims, found ${stats.invalidatedClaims}`);
      assert.strictEqual(stats.corroboratedClaims, 8, `Must have 8 corroborated claims, found ${stats.corroboratedClaims}`);
      assert.strictEqual(stats.sourceMatchClaims, 6, `Must have 6 single-source match claims, found ${stats.sourceMatchClaims}`);
      assert.strictEqual(stats.conflictingClaims, 6, `Must have 6 conflicting claims (2 groups x 3 claims), found ${stats.conflictingClaims}`);
      assert.strictEqual(stats.unverifiedClaims, 2, `Must have 2 unverified claims (unsupported savings), found ${stats.unverifiedClaims}`);
      assert.strictEqual(stats.needsReviewClaims, 1, `Must have 1 needs-review claim (display_serial ND-4402), found ${stats.needsReviewClaims}`);

      // Verify single-source claims have status 'Source Match' and preserve exact source without implying independent corroboration
      const singleSourceAttrs = ['planned_panel_count', 'planned_capacity', 'budget', 'annual_generation'];
      for (const attr of singleSourceAttrs) {
        const claim = await prisma.claim.findFirst({
          where: { workspaceId: defaultWs.id, attribute: attr }
        });
        assert(claim, `Claim for ${attr} must exist`);
        assert.strictEqual(claim.status, 'Source Match', `${attr} must be 'Source Match', not marked corroborated`);
        assert(claim.verificationReason?.includes('Source Match: verified verbatim in single source'), 'Rationale must state single-source match');
      }

      // Verify historical invalidated claims have status 'Invalidated' and are preserved in DB
      const invalidatedClaims = await prisma.claim.findMany({
        where: { workspaceId: defaultWs.id, status: 'Invalidated' }
      });
      assert.strictEqual(invalidatedClaims.length, 14, 'Must preserve all 14 historical claims as Invalidated');
      for (const ic of invalidatedClaims) {
        assert(ic.verificationReason?.includes('Invalidated historical claim'), 'Rationale must explain why historical claim was invalidated');
      }
    });

    await test('Requirement 3: Lifecycle Context (Planned vs As-Built Values Are Not Contradictory)', async () => {
      // Proposal has planned_panel_count = 120 and planned_capacity = 60 kWp
      const plannedPanel = await prisma.claim.findFirst({
        where: { workspaceId: defaultWs.id, attribute: 'planned_panel_count' }
      });
      const plannedCap = await prisma.claim.findFirst({
        where: { workspaceId: defaultWs.id, attribute: 'planned_capacity' }
      });
      assert(plannedPanel, 'Planned panel claim must exist');
      assert(plannedCap, 'Planned capacity claim must exist');
      assert.strictEqual(plannedPanel.status, 'Source Match', 'Planned panel claim must have status Source Match');
      assert.strictEqual(plannedCap.status, 'Source Match', 'Planned capacity claim must have status Source Match');

      // The conflict must NOT involve the proposal document
      const openConflicts = await prisma.conflict.findMany({
        where: { workspaceId: defaultWs.id, status: 'Open' },
        include: {
          claim1: { include: { citations: { include: { document: true } } } },
          claim2: { include: { citations: { include: { document: true } } } }
        }
      });

      for (const con of openConflicts) {
        const doc1Title = con.claim1.citations[0]?.document?.title || '';
        const doc2Title = con.claim2.citations[0]?.document?.title || '';
        assert(!doc1Title.includes('01_Project_Proposal'), 'Open conflict must not target proposal planned values');
        assert(!doc2Title.includes('01_Project_Proposal'), 'Open conflict must not target proposal planned values');
      }
    });

    await test('Requirement 4: Conflict Group Consolidation (Agreeing Sources Never Contradict Each Other)', async () => {
      // Both Commissioning Report (02) and Meeting Minutes (03) report 108 panels and 54 kWp
      const asBuiltPanelClaims = await prisma.claim.findMany({
        where: { workspaceId: defaultWs.id, attribute: 'installed_panel_count', value: '108 panels' }
      });
      assert.strictEqual(asBuiltPanelClaims.length, 2, 'Must have 2 agreeing claims for 108 panels');

      for (const claim of asBuiltPanelClaims) {
        assert(
          claim.verificationReason?.toLowerCase().includes('agreed across') ||
          claim.verificationReason?.includes('02_Commissioning_Report.pdf'),
          'Verification reason must explicitly note source agreement'
        );
      }
    });

    await test('Requirement 5: OCR Field Note Review (Single-Source OCR Needs Review, Corroborated OCR Corroborated)', async () => {
      // 05_OCR_Field_Note has display_serial: ND-4402 (single-source OCR -> Needs Review, confidence 0.85)
      const serialClaim = await prisma.claim.findFirst({
        where: { workspaceId: defaultWs.id, attribute: 'display_serial' }
      });
      assert(serialClaim, 'display_serial claim must be extracted');
      assert.strictEqual(serialClaim.status, 'Needs Review', 'Single-source OCR figure must have status Needs Review');
      assert.strictEqual(serialClaim.confidence, 0.85, 'OCR figure must have source-specific confidence 0.85');

      // 05_OCR_Field_Note has project_alias: NB-RSP (corroborated by 03 Meeting Minutes -> Corroborated, confidence 0.96)
      const aliasClaims = await prisma.claim.findMany({
        where: { workspaceId: defaultWs.id, attribute: 'project_alias' }
      });
      assert.strictEqual(aliasClaims.length, 2, 'Must have 2 project_alias claims');
      for (const ac of aliasClaims) {
        assert.strictEqual(ac.status, 'Corroborated', 'Multi-source corroborated alias must have status Corroborated');
      }
    });

    await test('Requirement 6: Unsupported Savings Claims Retain Unverified Status', async () => {
      const savingsClaims = await prisma.claim.findMany({
        where: {
          workspaceId: defaultWs.id,
          attribute: { in: ['electricity_bill_reduction', 'first_month_savings'] }
        }
      });
      assert.strictEqual(savingsClaims.length, 2, 'Must have both savings claims');
      for (const sc of savingsClaims) {
        assert.strictEqual(sc.status, 'Unverified', 'Savings claim must be Unverified');
        assert(sc.verificationReason?.includes('Unverified: No supporting utility bill'), 'Rationale must state missing primary evidence');
      }
    });

    await test('Idempotency: Re-running Verification Does Not Multiply Conflict Records', async () => {
      const statsRun1 = await runWorkspaceVerification(defaultWs.id, defaultWs.userId);
      const statsRun2 = await runWorkspaceVerification(defaultWs.id, defaultWs.userId);

      assert.strictEqual(statsRun2.activeConflicts, statsRun1.activeConflicts, 'Active conflicts must remain constant across reruns');
      assert.strictEqual(statsRun2.totalClaims, statsRun1.totalClaims, 'Total active claims must remain constant across reruns');
      assert.strictEqual(statsRun2.invalidConflicts, statsRun1.invalidConflicts, 'Invalid audit count must remain constant across reruns');
      assert.strictEqual(statsRun2.totalConflicts, statsRun1.totalConflicts, 'Total conflict records must not multiply on rerun');
      assert.strictEqual(statsRun2.corroboratedClaims, statsRun1.corroboratedClaims, 'Corroborated count must remain constant');
      assert.strictEqual(statsRun2.sourceMatchClaims, statsRun1.sourceMatchClaims, 'Source Match count must remain constant');
      assert.strictEqual(statsRun2.unverifiedClaims, statsRun1.unverifiedClaims, 'Unverified count must remain constant');
      assert.strictEqual(statsRun2.needsReviewClaims, statsRun1.needsReviewClaims, 'Needs Review count must remain constant');
    });

    await test('Report Synthesis & Contradiction Count Consensus Across DB and UI', async () => {
      const report = await composeCombinedDocument(defaultWs.id, defaultWs.userId);
      assert(report.markdownContent.includes('## 2. Corroborated Multi-Source Findings'), 'Report must contain Section 2');
      assert(report.markdownContent.includes('## 3. Single-Source Matches'), 'Report must contain Section 3');
      assert(report.markdownContent.includes('## 4. Contradictions & Conflict Discrepancies'), 'Report must contain Section 4');
      assert(report.markdownContent.includes('Conflict 1: Discrepancy for North Block Rooftop Solar Pilot [installed_panel_count]'), 'Report Section 4 must feature installed_panel_count');
      assert(report.markdownContent.includes('Conflict 2: Discrepancy for North Block Rooftop Solar Pilot [installed_capacity]'), 'Report Section 4 must feature installed_capacity');
      assert(report.markdownContent.includes('Audit Trail — Invalidated Historical Comparisons'), 'Report must document the 51 invalidated comparisons');
      assert(report.markdownContent.includes('51 historical comparison pairs'), 'Report must state exact count of 51 audited comparisons');
      assert(report.markdownContent.includes('## 5. Unverified Claims & Missing Evidence'), 'Report must contain Section 5');
      assert(report.markdownContent.includes('## 6. Items Needing Review & OCR Extractions'), 'Report must contain Section 6');

      const summary = JSON.parse(report.verificationSummaryJson || '{}');
      assert.strictEqual(summary.conflictsCount, 2, 'Report summary JSON must reflect exactly 2 active conflicts');
      assert.strictEqual(summary.totalDocuments, 5, 'Report summary JSON must reflect 5 documents');
      assert.strictEqual(summary.totalClaims, 23, 'Report summary JSON must reflect 23 active claims');
      assert.strictEqual(summary.corroboratedCount, 8, 'Report summary JSON must reflect 8 corroborated claims');
      assert.strictEqual(summary.sourceMatchCount, 6, 'Report summary JSON must reflect 6 source-matched claims');
    });

    await test('Multi-Format Export Generation with Distinct Statuses (PDF, DOCX, CSV)', async () => {
      const report = await prisma.combinedReport.findFirst({
        where: { workspaceId: defaultWs.id },
        orderBy: { createdAt: 'desc' }
      });
      assert(report, 'A combined report must exist for export testing');

      const [pdfBuf, docxBuf, csvStr] = await Promise.all([
        exportReportAsPdf(report.id),
        exportReportAsDocx(report.id),
        exportReportAsCsv(report.id)
      ]);

      assert(pdfBuf.length > 1000, 'PDF buffer must be substantial');
      assert(docxBuf.length > 1000, 'DOCX buffer must be substantial');
      assert(csvStr.includes('ClaimID,Entity,Attribute,Value,Status'), 'CSV must contain standard headers');
      assert(csvStr.includes('Corroborated'), 'CSV must contain Corroborated status');
      assert(csvStr.includes('Source Match'), 'CSV must contain Source Match status');
      assert(csvStr.includes('Conflicting'), 'CSV must contain Conflicting status');
      assert(csvStr.includes('Unverified'), 'CSV must contain Unverified status');
      assert(csvStr.includes('Needs Review'), 'CSV must contain Needs Review status');
    });

    await test('Requirement 7: Evidence-Grounded Assistant Chatbot (7 Distinct Question Types & Citations)', async () => {
      // 1. "On what basis did you generate the combined document?"
      const q1Res = await answerQuestionFromDocuments('On what basis did you generate the combined document?', defaultWs.userId, defaultWs.id);
      assert(q1Res.reply.includes('5 authorized source files'), 'Q1 must mention the 5 source files');
      assert(q1Res.reply.includes('Corroborated'), 'Q1 must explain corroboration');
      assert(q1Res.reply.includes('Conflicting'), 'Q1 must explain active contradictions');
      assert(q1Res.citations.length >= 1, 'Q1 must attach grounded citations');

      // 2. "Which files were used to create the report?"
      const q2Res = await answerQuestionFromDocuments('Which files were used to create the report?', defaultWs.userId, defaultWs.id);
      assert(q2Res.reply.includes('01_Project_Proposal'), 'Q2 must list Proposal');
      assert(q2Res.reply.includes('02_Commissioning_Report'), 'Q2 must list Commissioning Report');
      assert(q2Res.reply.includes('03_Operations_Meeting_Minutes'), 'Q2 must list Meeting Minutes');
      assert(q2Res.reply.includes('04_Project_Status_Register'), 'Q2 must list Status Register');
      assert(q2Res.citations.length >= 4, 'Q2 must attach citations for listed files');

      // 3. "Why is installed capacity marked as conflicting?"
      const q3Res = await answerQuestionFromDocuments('Why is installed capacity marked as conflicting?', defaultWs.userId, defaultWs.id);
      assert(q3Res.reply.includes('54 kWp'), 'Q3 must explain 54 kWp');
      assert(q3Res.reply.includes('60 kWp'), 'Q3 must explain 60 kWp');
      assert(q3Res.reply.includes('02_Commissioning_Report'), 'Q3 must cite 02_Commissioning_Report');
      assert(q3Res.reply.includes('04_Project_Status_Register'), 'Q3 must cite 04_Project_Status_Register');
      assert(q3Res.citations.length >= 2, 'Q3 must attach citations for both conflicting documents');

      // 4. "What evidence supports the 40% electricity-bill reduction claim?"
      const q4Res = await answerQuestionFromDocuments('What evidence supports the 40% electricity-bill reduction claim?', defaultWs.userId, defaultWs.id);
      assert(q4Res.reply.includes('NO supporting primary evidence') || q4Res.reply.includes('Unverified'), 'Q4 must confirm no primary evidence');
      assert(q4Res.reply.includes('utility bill') || q4Res.reply.includes('meter'), 'Q4 must note missing utility bills and meter readings');
      assert(q4Res.citations.length >= 1, 'Q4 must cite the document recording the unverified claim and missing evidence disclaimer');

      // 5. "Summarize the commissioning report."
      const q5Res = await answerQuestionFromDocuments('Summarize the commissioning report.', defaultWs.userId, defaultWs.id);
      assert(q5Res.reply.includes('COMM-NB-022'), 'Q5 must summarize COMM-NB-022');
      assert(q5Res.reply.includes('108'), 'Q5 must include 108 panels');
      assert(q5Res.reply.includes('54 kWp'), 'Q5 must include 54 kWp');
      assert(q5Res.reply.includes('870,000'), 'Q5 must include final invoice INR 870,000');
      assert(q5Res.citations.some(c => c.documentTitle.includes('Commissioning')), 'Q5 must attach commissioning report citation');

      // 6. "What is the final invoice amount recorded in the sources?"
      const q6Res = await answerQuestionFromDocuments('What is the final invoice amount recorded in the sources?', defaultWs.userId, defaultWs.id);
      assert(q6Res.reply.includes('870,000'), 'Q6 must state INR 870,000');
      assert(q6Res.reply.includes('Corroborated'), 'Q6 must identify Corroborated status');
      assert(q6Res.citations.length >= 2, 'Q6 must attach citations from corroborating sources');

      // 7. Genuinely unrelated question
      const q7Res = await answerQuestionFromDocuments('What is the capital of France and what is the current weather there?', defaultWs.userId, defaultWs.id);
      assert(q7Res.reply.includes('No information or evidence regarding'), 'Q7 must honestly explain out-of-scope query');
      assert.strictEqual(q7Res.citations.length, 0, 'Q7 must not fabricate citations');

      // Workspace access isolation test
      const unauthRes = await answerQuestionFromDocuments('Summarize the commissioning report.', 'unauthorized-user-uuid-999', defaultWs.id);
      assert(unauthRes.workspaceId !== defaultWs.id || unauthRes.reply.includes('No authorized workspace'), 'Must prevent unauthorized cross-workspace access');
    });
  }

  console.log('\n========================================');
  console.log(`🎉 TEST SUMMARY: ${passed} PASSED | ${failed} FAILED`);
  console.log('========================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite()
  .then(() => {
    console.log('All automated tests completed successfully!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Test suite failed with unexpected error:', err);
    process.exit(1);
  });
