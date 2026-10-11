import { PrismaClient } from '@prisma/client';
import { extractDocumentText } from './extractor';
import {
  extractClaimsFromDocument,
  resolveCanonicalEntity,
  normalizeAttribute,
  normalizeValue,
  isIgnoredHeadingOrNonClaim,
  RawExtractedClaim
} from './claimExtractor';

const prisma = new PrismaClient();

export interface VerificationStats {
  totalDocuments: number;
  duplicateDocuments: number;
  totalClaims: number; // Active claims (excluding historical Invalidated claims)
  corroboratedClaims: number; // Multi-source corroborated facts
  sourceMatchClaims: number; // Single-source verified extractions (not corroborated)
  verifiedClaims: number; // Total corroborated + sourceMatch
  conflictingClaims: number; // Claims in active conflict groups
  unverifiedClaims: number; // Unsupported claims (missing evidence)
  needsReviewClaims: number; // Items needing review (e.g. uncorroborated OCR)
  invalidatedClaims: number; // Historical false-positive claims in audit trail
  activeConflicts: number; // Count of unique active conflict groups
  invalidConflicts: number; // Count of invalidated conflict records
  resolvedConflicts: number; // Count of resolved conflicts
  totalConflicts: number; // Total conflict records in DB
  conflictRecordsCount: number; // Backwards compatibility for callers expecting active count
}

/**
 * Compare project stages for factual contradiction compatibility.
 * e.g., 'planned' budget vs 'actual' final invoice must never be treated as contradictions.
 */
export function isStageComparable(s1?: string, s2?: string): boolean {
  if (!s1 || !s2 || s1 === 'unspecified' || s2 === 'unspecified') return true;
  if (s1 === s2) return true;
  const postStages = new Set(['as_built', 'actual', 'operational']);
  if (postStages.has(s1) && postStages.has(s2)) return true;
  // planned vs post-completion stages are distinct stages, not contradictory
  if ((s1 === 'planned' && postStages.has(s2)) || (s2 === 'planned' && postStages.has(s1))) {
    return false;
  }
  return false;
}

export async function runWorkspaceVerification(workspaceId: string, userId: string): Promise<VerificationStats> {
  // 1. Fetch all documents for this workspace and user
  const documents = await prisma.document.findMany({
    where: {
      workspaceId,
      userId
    }
  });

  if (documents.length === 0) {
    return {
      totalDocuments: 0,
      duplicateDocuments: 0,
      totalClaims: 0,
      corroboratedClaims: 0,
      sourceMatchClaims: 0,
      verifiedClaims: 0,
      conflictingClaims: 0,
      unverifiedClaims: 0,
      needsReviewClaims: 0,
      invalidatedClaims: 0,
      activeConflicts: 0,
      invalidConflicts: 0,
      resolvedConflicts: 0,
      totalConflicts: 0,
      conflictRecordsCount: 0
    };
  }

  // 2. Check for duplicate documents based on fileHash
  const seenHashes = new Map<string, string>(); // hash -> docTitle
  let duplicateDocsCount = 0;

  for (const doc of documents) {
    if (!doc.fileHash) continue;
    if (seenHashes.has(doc.fileHash)) {
      duplicateDocsCount++;
      await prisma.document.update({
        where: { id: doc.id },
        data: {
          limitationNotes: `Duplicate file detected (identical SHA-256 hash to ${seenHashes.get(doc.fileHash)})`
        }
      });
    } else {
      seenHashes.set(doc.fileHash, doc.title);
    }
  }

  // 3. AUDIT TRAIL RECONCILIATION:
  // Review existing conflict records and invalidate false positives without destroying audit history.
  const existingConflicts = await prisma.conflict.findMany({
    where: { workspaceId },
    include: {
      claim1: true,
      claim2: true
    }
  });

  for (const c of existingConflicts) {
    const val1 = c.claim1?.value || '';
    const val2 = c.claim2?.value || '';
    const isFalsePositive =
      c.attribute === 'statement' ||
      c.claim1?.attribute === 'statement' ||
      c.claim2?.attribute === 'statement' ||
      c.description.includes('Discrepancy for  [statement]') ||
      isIgnoredHeadingOrNonClaim(val1) ||
      isIgnoredHeadingOrNonClaim(val2) ||
      val1.toLowerCase().includes('recorded as-built values') ||
      val2.toLowerCase().includes('recorded as-built values') ||
      val1.toLowerCase().includes('evidence not included') ||
      val2.toLowerCase().includes('evidence not included');

    if (isFalsePositive && c.status !== 'Invalid') {
      const reasonPrefix = '[INVALID - False Positive]: Compared unrelated structural statements/headings without opposing factual values.';
      const newDescription = c.description.startsWith('[INVALID - False Positive]')
        ? c.description
        : `${reasonPrefix} Original: ${c.description}`;

      await prisma.conflict.update({
        where: { id: c.id },
        data: {
          status: 'Invalid',
          description: newDescription
        }
      });

      // Update referenced historical statement claims with distinct 'Invalidated' status
      if (c.claim1 && (c.claim1.attribute === 'statement' || isIgnoredHeadingOrNonClaim(c.claim1.value || ''))) {
        await prisma.claim.update({
          where: { id: c.claim1.id },
          data: {
            status: 'Invalidated',
            verificationReason: 'Invalidated historical claim from prior sentence-level extraction run.'
          }
        });
      }
      if (c.claim2 && (c.claim2.attribute === 'statement' || isIgnoredHeadingOrNonClaim(c.claim2.value || ''))) {
        await prisma.claim.update({
          where: { id: c.claim2.id },
          data: {
            status: 'Invalidated',
            verificationReason: 'Invalidated historical claim from prior sentence-level extraction run.'
          }
        });
      }
    }
  }

  // Ensure all historical statement claims are marked 'Invalidated' so they never show as 'Needs Review'
  await prisma.claim.updateMany({
    where: {
      workspaceId,
      OR: [
        { attribute: 'statement' },
        { verificationReason: { contains: 'Invalidated historical claim' } }
      ]
    },
    data: {
      status: 'Invalidated',
      verificationReason: 'Invalidated historical claim from prior sentence-level extraction run.'
    }
  });

  // 4. Collect claim IDs tied to Invalid audit records so they are preserved
  const invalidAuditConflicts = await prisma.conflict.findMany({
    where: { workspaceId, status: 'Invalid' }
  });
  const invalidAuditClaimIds = new Set<string>();
  invalidAuditConflicts.forEach(c => {
    if (c.claimId1) invalidAuditClaimIds.add(c.claimId1);
    if (c.claimId2) invalidAuditClaimIds.add(c.claimId2);
  });
  // Also preserve any claims with status 'Invalidated'
  const invalidatedClaimsInDb = await prisma.claim.findMany({
    where: { workspaceId, status: 'Invalidated' },
    select: { id: true }
  });
  invalidatedClaimsInDb.forEach(cl => invalidAuditClaimIds.add(cl.id));

  // 5. Ensure documents are extracted and extract typed factual claims
  interface IngestedClaimItem extends RawExtractedClaim {
    docId: string;
    docTitle: string;
    canonicalEntity: string;
    normalizedAttr: string;
    normValue: string;
    verifiedInText: boolean;
    hasDocLimitation: boolean;
  }

  const rawClaimsList: IngestedClaimItem[] = [];

  for (const doc of documents) {
    let text = doc.extractedText || '';
    let status = doc.status;
    let extractionStatus = doc.extractionStatus;

    if (!text || doc.extractionStatus === 'Pending' || doc.extractionStatus === 'Failed' || doc.status === 'Failed') {
      const result = await extractDocumentText(doc.storagePath, doc.originalName, doc.mimeType);
      text = result.text;
      status = result.status === 'Extracted' || result.status === 'OCR_Fallback' ? 'Completed' : 'Failed';
      extractionStatus = result.status;

      await prisma.document.update({
        where: { id: doc.id },
        data: {
          extractedText: text,
          pageCount: result.pageCount,
          wordCount: result.wordCount,
          status,
          extractionStatus,
          limitationNotes: result.limitationNotes || null,
          fileHash: result.fileHash
        }
      });
    }

    if (text && text.trim().length > 0) {
      const extracted = await extractClaimsFromDocument(text, doc.title, doc.id);
      for (const item of extracted) {
        // Skip structural headings or non-factual statements
        if (isIgnoredHeadingOrNonClaim(item.value) || item.attribute === 'statement' || item.attribute === 'heading') {
          continue;
        }

        const cleanExcerpt = item.excerpt.replace(/\.\.\.$/, '').trim();
        const exactMatch =
          text.includes(cleanExcerpt) ||
          text.replace(/\s+/g, ' ').includes(cleanExcerpt.replace(/\s+/g, ' '));
        const hasDocLimitation = extractionStatus === 'Partial' || extractionStatus === 'OCR_Fallback';
        const canonicalEntity = resolveCanonicalEntity(item.entity, text);
        const normalizedAttr = normalizeAttribute(item.attribute);
        const normValue = normalizeValue(item.value, normalizedAttr);

        rawClaimsList.push({
          ...item,
          docId: doc.id,
          docTitle: doc.title,
          canonicalEntity,
          normalizedAttr,
          normValue,
          verifiedInText: exactMatch,
          hasDocLimitation
        });
      }
    }
  }

  // 6. Cluster claims by canonicalEntity + normalizedAttr to evaluate status
  const clusterMap = new Map<string, IngestedClaimItem[]>();
  for (const item of rawClaimsList) {
    const key = `${item.canonicalEntity}::${item.normalizedAttr}`;
    if (!clusterMap.has(key)) {
      clusterMap.set(key, []);
    }
    clusterMap.get(key)!.push(item);
  }

  // Store newly created DB claims to establish conflict pairs
  interface ActiveDbClaim {
    id: string;
    docId: string;
    docTitle: string;
    canonicalEntity: string;
    normalizedAttr: string;
    normValue: string;
    value: string;
    stage?: string;
    evidenceMissing?: boolean;
    excerpt: string;
    location: string;
  }
  const createdActiveClaims: ActiveDbClaim[] = [];

  for (const [clusterKey, items] of clusterMap.entries()) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let claimStatus: 'Corroborated' | 'Source Match' | 'Conflicting' | 'Unverified' | 'Needs Review' = 'Source Match';
      let reason = 'Initial evaluation';
      let isDuplicate = false;

      // 1. Evidence explicitly marked missing (e.g. 40% bill reduction, INR 250,000 savings)
      if (item.evidenceMissing) {
        claimStatus = 'Unverified';
        reason = 'Unverified: No supporting utility bill, meter reading, or financial record attached in documents.';
      } else {
        // 2. Find opposing claims in the same cluster with comparable stage
        const opposing = items.filter(other => 
          other.docId !== item.docId &&
          !other.evidenceMissing &&
          isStageComparable(item.stage, other.stage) &&
          other.normValue.toLowerCase() !== item.normValue.toLowerCase()
        );

        if (opposing.length > 0) {
          claimStatus = 'Conflicting';
          const agreeingInConflict = items.filter(other => 
            other.docId !== item.docId &&
            other.normValue.toLowerCase() === item.normValue.toLowerCase()
          );

          if (agreeingInConflict.length > 0) {
            const agreeTitles = Array.from(new Set([item.docTitle, ...agreeingInConflict.map(a => a.docTitle)]));
            const oppTitles = Array.from(new Set(opposing.map(o => o.docTitle)));
            reason = `Value "${item.value}" is agreed across ${agreeTitles.join(' and ')}; in active discrepancy with ${oppTitles.join(', ')} ("${opposing[0].value}").`;
          } else {
            reason = `Direct discrepancy with "${opposing[0].docTitle}". Value "${item.value}" differs from "${opposing[0].value}".`;
          }
        } else if (!item.verifiedInText) {
          claimStatus = 'Needs Review';
          reason = 'Supporting excerpt could not be verified verbatim in stored extracted text.';
        } else {
          // 3. Check for multi-source consensus across independent documents
          const agreeingOthers = items.filter(other => 
            other.docId !== item.docId &&
            other.normValue.toLowerCase() === item.normValue.toLowerCase()
          );

          if (agreeingOthers.length > 0) {
            // Multi-source consensus!
            claimStatus = 'Corroborated';
            const otherTitles = Array.from(new Set(agreeingOthers.map(o => o.docTitle)));
            if (item.hasDocLimitation) {
              reason = `Corroborated by independent text source (${otherTitles.join(', ')}); OCR extraction confirmed by cross-source consensus.`;
            } else {
              reason = `Corroborated with multi-source consensus across ${otherTitles.join(', ')}.`;
            }
            if (i > 0) isDuplicate = true;
          } else {
            // Single-source claim
            if (item.hasDocLimitation) {
              // Uncorroborated OCR claim
              claimStatus = 'Needs Review';
              reason = 'Source document underwent OCR image extraction; uncorroborated figures require manual human review against physical equipment.';
            } else {
              // Single-source clean text match
              claimStatus = 'Source Match';
              const stageNote = item.stage && item.stage !== 'unspecified' ? ` [Stage: ${item.stage}]` : '';
              reason = `Source Match: verified verbatim in single source ${item.docTitle} (${item.location})${stageNote}; single-source record without independent corroboration.`;
            }
          }
        }
      }

      // Create new active claim record in DB
      const dbClaim = await prisma.claim.create({
        data: {
          workspaceId,
          claimText: item.claimText,
          entity: item.canonicalEntity,
          attribute: item.normalizedAttr,
          value: item.value,
          status: claimStatus,
          confidence: item.confidence,
          verificationReason: reason,
          isDuplicate,
          citations: {
            create: {
              documentId: item.docId,
              excerpt: item.excerpt,
              location: item.location,
              charStart: item.charStart,
              charEnd: item.charEnd,
              verifiedInText: item.verifiedInText
            }
          }
        }
      });

      createdActiveClaims.push({
        id: dbClaim.id,
        docId: item.docId,
        docTitle: item.docTitle,
        canonicalEntity: item.canonicalEntity,
        normalizedAttr: item.normalizedAttr,
        normValue: item.normValue,
        value: item.value,
        stage: item.stage,
        evidenceMissing: item.evidenceMissing,
        excerpt: item.excerpt,
        location: item.location
      });
    }
  }

  // 7. DETECT GENUINE CONFLICTS & IDEMPOTENT CREATION:
  // Count conflict groups once (e.g. 1 group for panel-count, 1 group for capacity)
  const activeConflictsCreated = new Set<string>();

  for (let i = 0; i < createdActiveClaims.length; i++) {
    for (let j = i + 1; j < createdActiveClaims.length; j++) {
      const c1 = createdActiveClaims[i];
      const c2 = createdActiveClaims[j];

      // Must be from different documents
      if (c1.docId === c2.docId) continue;

      // Must refer to the same canonical entity and normalized attribute
      if (c1.canonicalEntity !== c2.canonicalEntity) continue;
      if (c1.normalizedAttr !== c2.normalizedAttr) continue;
      if (c1.normalizedAttr === 'statement') continue;

      // Must NOT be missing evidence (missing evidence is Unverified, not an opposing value)
      if (c1.evidenceMissing || c2.evidenceMissing) continue;

      // Must have comparable project stages
      if (!isStageComparable(c1.stage, c2.stage)) continue;

      // Must have opposing values
      if (c1.normValue.toLowerCase() === c2.normValue.toLowerCase()) continue;

      // Group conflict identity by entity + attribute so that repeated documents don't create duplicate conflict records
      const conflictIdentity = `${c1.canonicalEntity}::${c1.normalizedAttr}`;
      if (activeConflictsCreated.has(conflictIdentity)) continue;
      activeConflictsCreated.add(conflictIdentity);

      const conflictDescription = `Discrepancy for ${c1.canonicalEntity} [${c1.normalizedAttr}]: "${c1.value}" (${c1.docTitle}, ${c1.location}) vs "${c2.value}" (${c2.docTitle}, ${c2.location})`;

      // Check if an existing open conflict record already exists in DB for this entity & attribute
      const existingOpen = await prisma.conflict.findFirst({
        where: {
          workspaceId,
          entity: c1.canonicalEntity,
          attribute: c1.normalizedAttr,
          status: 'Open'
        }
      });

      if (existingOpen) {
        // Update links to latest claims without creating duplicate conflict rows
        await prisma.conflict.update({
          where: { id: existingOpen.id },
          data: {
            claimId1: c1.id,
            claimId2: c2.id,
            description: conflictDescription
          }
        });
      } else {
        await prisma.conflict.create({
          data: {
            workspaceId,
            entity: c1.canonicalEntity,
            attribute: c1.normalizedAttr,
            description: conflictDescription,
            claimId1: c1.id,
            claimId2: c2.id,
            status: 'Open'
          }
        });
      }
    }
  }

  // 7.5. Clean up prior active claims that are not in the new batch and not part of the audit trail
  const keepClaimIds = new Set<string>([
    ...invalidAuditClaimIds,
    ...createdActiveClaims.map(c => c.id)
  ]);
  await prisma.claim.deleteMany({
    where: {
      workspaceId,
      id: { notIn: Array.from(keepClaimIds) }
    }
  });

  // 8. Aggregated statistics query directly from DB
  const [docCount, allDbClaims, openConflictsCount, invalidConflictsCount, resolvedConflictsCount, totalConflictsCount] = await Promise.all([
    prisma.document.count({ where: { workspaceId } }),
    prisma.claim.findMany({ where: { workspaceId } }),
    prisma.conflict.count({ where: { workspaceId, status: 'Open' } }),
    prisma.conflict.count({ where: { workspaceId, status: 'Invalid' } }),
    prisma.conflict.count({ where: { workspaceId, status: 'Resolved' } }),
    prisma.conflict.count({ where: { workspaceId } })
  ]);

  const activeClaims = allDbClaims.filter(c => c.status !== 'Invalidated' && c.attribute !== 'statement');
  const corroboratedCount = activeClaims.filter(c => c.status === 'Corroborated').length;
  const sourceMatchCount = activeClaims.filter(c => c.status === 'Source Match').length;
  const verifiedCount = corroboratedCount + sourceMatchCount;
  const conflictingCount = activeClaims.filter(c => c.status === 'Conflicting').length;
  const unverifiedCount = activeClaims.filter(c => c.status === 'Unverified').length;
  const needsReviewCount = activeClaims.filter(c => c.status === 'Needs Review').length;
  const invalidatedCount = allDbClaims.filter(c => c.status === 'Invalidated' || c.attribute === 'statement').length;

  return {
    totalDocuments: docCount,
    duplicateDocuments: duplicateDocsCount,
    totalClaims: activeClaims.length,
    corroboratedClaims: corroboratedCount,
    sourceMatchClaims: sourceMatchCount,
    verifiedClaims: verifiedCount,
    conflictingClaims: conflictingCount,
    unverifiedClaims: unverifiedCount,
    needsReviewClaims: needsReviewCount,
    invalidatedClaims: invalidatedCount,
    activeConflicts: openConflictsCount,
    invalidConflicts: invalidConflictsCount,
    resolvedConflicts: resolvedConflictsCount,
    totalConflicts: totalConflictsCount,
    conflictRecordsCount: openConflictsCount
  };
}
