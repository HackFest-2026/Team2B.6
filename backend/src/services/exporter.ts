import PDFDocument from 'pdfkit';
import { Document as DocxDocument, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle } from 'docx';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function exportReportAsPdf(reportId: string): Promise<Buffer> {
  const report = await prisma.combinedReport.findUnique({
    where: { id: reportId },
    include: {
      workspace: {
        include: {
          documents: true,
          claims: { include: { citations: { include: { document: true } } } },
          conflicts: {
            include: {
              claim1: { include: { citations: { include: { document: true } } } },
              claim2: { include: { citations: { include: { document: true } } } }
            }
          }
        }
      }
    }
  });

  if (!report) throw new Error('Report not found');

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', err => reject(err));

    // Header & Brand
    doc.fillColor('#4338CA').fontSize(22).font('Helvetica-Bold').text('VERIMERGE', { align: 'left' });
    doc.fillColor('#6B7280').fontSize(10).font('Helvetica').text('Multi-Source Ingestion & Evidence Verification Report', { align: 'left' });
    doc.moveDown(1);

    // Title
    doc.fillColor('#111827').fontSize(16).font('Helvetica-Bold').text(report.title);
    doc.fillColor('#4B5563').fontSize(9).font('Helvetica').text(`Generated: ${new Date(report.createdAt).toLocaleDateString()} | Author ID: ${report.userId}`);
    doc.moveDown(1.5);

    // Summary Box
    doc.rect(50, doc.y, 495, 55).fillAndStroke('#EEF2FF', '#C7D2FE');
    doc.fillColor('#1E1B4B').fontSize(10).font('Helvetica-Bold').text('Executive Summary', 60, doc.y + 10);
    doc.fillColor('#374151').fontSize(9).font('Helvetica').text(report.executiveSummary || 'Verified multi-source document synthesis.', 60, doc.y + 3);
    doc.moveDown(2.5);

    // Verified Findings Section
    const activeClaims = report.workspace?.claims.filter(c => c.status !== 'Invalidated' && c.attribute !== 'statement') || [];
    const corroboratedClaims = activeClaims.filter(c => c.status === 'Corroborated' || c.status === 'Verified');
    const sourceMatchClaims = activeClaims.filter(c => c.status === 'Source Match');
    const verifiedClaims = [...corroboratedClaims, ...sourceMatchClaims];
    doc.fillColor('#111827').fontSize(13).font('Helvetica-Bold').text(`Verified Key Findings (${verifiedClaims.length})`);
    doc.moveDown(0.5);

    verifiedClaims.slice(0, 15).forEach((claim, i) => {
      const tag = claim.status === 'Corroborated' ? '[Corroborated] ' : '[Source Match] ';
      doc.fillColor('#059669').fontSize(10).font('Helvetica-Bold').text(tag, { continued: true });
      doc.fillColor('#1F2937').font('Helvetica').text(`${claim.claimText}`);
      
      const cite = claim.citations[0];
      if (cite) {
        doc.fillColor('#6B7280').fontSize(8).font('Helvetica-Oblique')
          .text(`  Source: ${cite.document?.title} | Location: ${cite.location}`);
        doc.fillColor('#4B5563').fontSize(8).font('Helvetica')
          .text(`  Excerpt: "${cite.excerpt.slice(0, 150)}"`);
      }
      doc.moveDown(0.4);
    });

    doc.moveDown(1);

    // Conflicts Section
    const conflicts = report.workspace?.conflicts.filter(c => c.status === 'Open') || [];
    if (conflicts.length > 0) {
      doc.fillColor('#DC2626').fontSize(13).font('Helvetica-Bold').text(`Detected Contradictions (${conflicts.length})`);
      doc.moveDown(0.5);

      conflicts.forEach((con, i) => {
        doc.fillColor('#991B1B').fontSize(10).font('Helvetica-Bold').text(`Discrepancy: ${con.description}`);
        doc.fillColor('#4B5563').fontSize(8).font('Helvetica')
          .text(`  Source A (${con.claim1.citations[0]?.document?.title}): "${con.claim1.value}"`);
        doc.fillColor('#4B5563').fontSize(8).font('Helvetica')
          .text(`  Source B (${con.claim2.citations[0]?.document?.title}): "${con.claim2.value}"`);
        doc.moveDown(0.5);
      });
    }

    // Source Ledger
    doc.moveDown(1);
    doc.fillColor('#111827').fontSize(13).font('Helvetica-Bold').text('Document Provenance Ledger');
    doc.moveDown(0.5);
    report.workspace?.documents.forEach(d => {
      doc.fillColor('#374151').fontSize(8).font('Helvetica')
        .text(`• ${d.title} (${d.mimeType}) | Class: ${d.classification} | Hash: ${d.fileHash ? d.fileHash.slice(0, 16) + '...' : 'N/A'}`);
    });

    doc.end();
  });
}

export async function exportReportAsDocx(reportId: string): Promise<Buffer> {
  const report = await prisma.combinedReport.findUnique({
    where: { id: reportId },
    include: {
      workspace: {
        include: {
          documents: true,
          claims: { include: { citations: { include: { document: true } } } },
          conflicts: {
            include: {
              claim1: { include: { citations: { include: { document: true } } } },
              claim2: { include: { citations: { include: { document: true } } } }
            }
          }
        }
      }
    }
  });

  if (!report) throw new Error('Report not found');

  const activeClaims = report.workspace?.claims.filter(c => c.status !== 'Invalidated' && c.attribute !== 'statement') || [];
  const verifiedClaims = activeClaims.filter(c => c.status === 'Corroborated' || c.status === 'Source Match' || c.status === 'Verified');
  const conflicts = report.workspace?.conflicts.filter(c => c.status === 'Open') || [];

  const doc = new DocxDocument({
    sections: [{
      properties: {},
      children: [
        new Paragraph({
          text: 'VERIMERGE VERIFIED SYNTHESIS REPORT',
          heading: HeadingLevel.TITLE
        }),
        new Paragraph({
          children: [
            new TextRun({ text: report.title, bold: true, size: 28 })
          ]
        }),
        new Paragraph({
          children: [
            new TextRun({ text: `Generated: ${new Date(report.createdAt).toLocaleDateString()} | Workspace: ${report.workspace?.name || 'Default'}` })
          ]
        }),
        new Paragraph({ text: '' }),
        new Paragraph({
          text: 'Executive Summary',
          heading: HeadingLevel.HEADING_1
        }),
        new Paragraph({
          children: [
            new TextRun({ text: report.executiveSummary || 'Synthesis document generated with evidence verification.' })
          ]
        }),
        new Paragraph({ text: '' }),
        new Paragraph({
          text: 'Verified Findings',
          heading: HeadingLevel.HEADING_1
        }),
        ...verifiedClaims.map(c => new Paragraph({
          children: [
            new TextRun({ text: `[${c.status}] ${c.claimText}`, bold: true }),
            new TextRun({ text: `\nSource: ${c.citations[0]?.document?.title} (${c.citations[0]?.location})`, italics: true }),
            new TextRun({ text: `\nExcerpt: "${c.citations[0]?.excerpt}"` })
          ]
        })),
        new Paragraph({ text: '' }),
        new Paragraph({
          text: 'Detected Contradictions',
          heading: HeadingLevel.HEADING_1
        }),
        ...conflicts.map(con => new Paragraph({
          children: [
            new TextRun({ text: `Conflict: ${con.description}`, bold: true, color: 'DC2626' }),
            new TextRun({ text: `\nClaim 1: "${con.claim1.value}" (${con.claim1.citations[0]?.document?.title})` }),
            new TextRun({ text: `\nClaim 2: "${con.claim2.value}" (${con.claim2.citations[0]?.document?.title})` })
          ]
        }))
      ]
    }]
  });

  const { Packer } = await import('docx');
  return await Packer.toBuffer(doc as any);
}

export async function exportReportAsCsv(reportId: string): Promise<string> {
  const report = await prisma.combinedReport.findUnique({
    where: { id: reportId },
    include: {
      workspace: {
        include: {
          claims: { include: { citations: { include: { document: true } } } }
        }
      }
    }
  });

  if (!report) throw new Error('Report not found');

  const header = 'ClaimID,Entity,Attribute,Value,Status,Confidence,DocumentTitle,Location,Excerpt,VerifiedInText\n';
  const rows = (report.workspace?.claims || []).map(c => {
    const cite = c.citations[0];
    const escapeCsv = (str: string = '') => `"${str.replace(/"/g, '""')}"`;
    return [
      c.id,
      escapeCsv(c.entity || ''),
      escapeCsv(c.attribute || ''),
      escapeCsv(c.value || ''),
      c.status,
      c.confidence,
      escapeCsv(cite?.document?.title || ''),
      escapeCsv(cite?.location || ''),
      escapeCsv(cite?.excerpt || ''),
      cite?.verifiedInText ? 'TRUE' : 'FALSE'
    ].join(',');
  }).join('\n');

  return header + rows;
}
