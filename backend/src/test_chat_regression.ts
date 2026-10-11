import { PrismaClient } from '@prisma/client';
import { answerQuestionFromDocuments } from './services/chatService';

const prisma = new PrismaClient();

async function runRegressionTests() {
  console.log('===============================================================');
  console.log('VERIMERGE EVIDENCE-GROUNDED ASSISTANT CHATBOT REGRESSION SUITE');
  console.log('===============================================================\n');

  // 1. Locate the solar project workspace for user iyaragatti43@gmail.com
  const user = await prisma.user.findUnique({
    where: { email: 'iyaragatti43@gmail.com' },
    include: { workspaces: { include: { documents: true } } }
  });

  if (!user || user.workspaces.length === 0) {
    throw new Error('Test user or solar workspace not found in database');
  }

  const workspace = user.workspaces[0];
  console.log(`Testing against User: ${user.email} (ID: ${user.id})`);
  console.log(`Workspace: "${workspace.name}" (ID: ${workspace.id}) | Documents: ${workspace.documents.length}\n`);

  const testCases = [
    {
      id: 1,
      title: 'Synthesis Basis & Methodology',
      question: 'On what basis did you generate the combined document?',
      expectedKeywords: ['5', 'source files', 'Corroborated', 'Source Match', 'Conflicting', 'Unverified'],
      expectedMinCitations: 1,
      check: (res: any) => {
        return res.reply.includes('5') &&
               res.reply.includes('Corroborated') &&
               res.reply.includes('Conflicting') &&
               res.citations.length > 0;
      }
    },
    {
      id: 2,
      title: 'Ingested Files & Source Documentation',
      question: 'Which files were used to create the report?',
      expectedKeywords: ['01_Project_Proposal', '02_Commissioning_Report', '03_Operations_Meeting_Minutes', '04_Project_Status_Register'],
      expectedMinCitations: 4,
      check: (res: any) => {
        return res.reply.includes('01_Project_Proposal') &&
               res.reply.includes('02_Commissioning_Report') &&
               res.reply.includes('03_Operations_Meeting_Minutes') &&
               res.reply.includes('04_Project_Status_Register') &&
               res.citations.length >= 4;
      }
    },
    {
      id: 3,
      title: 'Installed Capacity Conflict Explanation',
      question: 'Why is installed capacity marked as conflicting?',
      expectedKeywords: ['54 kWp', '60 kWp', '02_Commissioning_Report', '04_Project_Status_Register'],
      expectedMinCitations: 2,
      check: (res: any) => {
        return res.reply.includes('54 kWp') &&
               res.reply.includes('60 kWp') &&
               res.reply.includes('02_Commissioning_Report') &&
               res.reply.includes('04_Project_Status_Register') &&
               res.citations.length >= 2;
      }
    },
    {
      id: 4,
      title: 'Missing Evidence Assessment (40% Bill Reduction)',
      question: 'What evidence supports the 40% electricity-bill reduction claim?',
      expectedKeywords: ['NO supporting primary evidence', 'Unverified', 'utility bill', 'meter'],
      expectedMinCitations: 1,
      check: (res: any) => {
        return (res.reply.includes('NO supporting primary evidence') || res.reply.includes('no supporting utility bill') || res.reply.includes('Unverified')) &&
               res.reply.includes('utility bill') &&
               res.citations.length >= 1;
      }
    },
    {
      id: 5,
      title: 'Document Summarization (Commissioning Report)',
      question: 'Summarize the commissioning report.',
      expectedKeywords: ['COMM-NB-022', '108', '54 kWp', '870,000', '2 inverters'],
      expectedMinCitations: 1,
      check: (res: any) => {
        return res.reply.includes('108') &&
               res.reply.includes('54 kWp') &&
               res.reply.includes('870,000') &&
               res.citations.some((c: any) => c.documentTitle.includes('Commissioning'));
      }
    },
    {
      id: 6,
      title: 'Factual Inquiry: Final Invoice Amount',
      question: 'What is the final invoice amount recorded in the sources?',
      expectedKeywords: ['INR 870,000', 'Corroborated', '02_Commissioning_Report', '03_Operations_Meeting_Minutes'],
      expectedMinCitations: 2,
      check: (res: any) => {
        return res.reply.includes('870,000') &&
               res.reply.includes('Corroborated') &&
               res.citations.length >= 2;
      }
    },
    {
      id: 7,
      title: 'Unrelated / Out-of-Scope Query',
      question: 'What is the capital of France and what is the current weather there?',
      expectedKeywords: ['No information or evidence regarding', 'zero-hallucination'],
      expectedMinCitations: 0,
      check: (res: any) => {
        return res.reply.includes('No information or evidence regarding') &&
               res.citations.length === 0;
      }
    }
  ];

  let passedCount = 0;

  for (const tc of testCases) {
    console.log(`---------------------------------------------------------------`);
    console.log(`TEST ${tc.id}: ${tc.title}`);
    console.log(`Question: "${tc.question}"`);

    const result = await answerQuestionFromDocuments(tc.question, user.id, workspace.id);
    const pass = tc.check(result);

    console.log(`Mode: ${result.mode}`);
    console.log(`Citations Count: ${result.citations.length}`);
    if (result.citations.length > 0) {
      console.log(`Citations Sample:`);
      result.citations.slice(0, 3).forEach((c, idx) => {
        console.log(`  [${idx + 1}] ${c.documentTitle} (${c.location}): "${c.excerpt?.slice(0, 70)}..." [Status: ${c.status}]`);
      });
    }
    if (result.conflictsWarning) {
      console.log(`Conflict Warning: ${result.conflictsWarning}`);
    }
    console.log(`Response Snippet:\n${result.reply.slice(0, 260).replace(/\n+/g, ' ')}...`);

    if (pass) {
      console.log(`=> RESULT: [PASSED]`);
      passedCount++;
    } else {
      console.log(`=> RESULT: [FAILED]`);
    }
    console.log();
  }

  // 8. Test Workspace Access Isolation
  console.log(`---------------------------------------------------------------`);
  console.log(`TEST 8: Workspace Access Control & Isolation`);
  const unauthorizedUserId = 'non-existent-user-uuid-999';
  const isolatedResult = await answerQuestionFromDocuments('Summarize the commissioning report.', unauthorizedUserId, workspace.id);
  // Should NOT access unauthorized user's private workspace
  const isIsolated = isolatedResult.workspaceId !== workspace.id || isolatedResult.reply.includes('No authorized workspace');
  console.log(`Isolated Access Attempt Response: ${isolatedResult.reply.slice(0, 150)}...`);
  if (isIsolated) {
    console.log(`=> RESULT: [PASSED] (Unauthorized user isolated successfully)`);
    passedCount++;
  } else {
    console.log(`=> RESULT: [FAILED] (Isolation breach)`);
  }

  console.log(`\n===============================================================`);
  console.log(`TEST SUMMARY: ${passedCount} / ${testCases.length + 1} PASSED`);
  console.log(`===============================================================`);

  if (passedCount !== testCases.length + 1) {
    process.exit(1);
  }
}

runRegressionTests().catch((err) => {
  console.error('Test Suite Failed:', err);
  process.exit(1);
}).finally(() => prisma.$disconnect());
