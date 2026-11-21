import { dbPool } from './index.js';
import { generateEmbedding, formatVectorForPg } from '../ai/embeddings.js';

export interface PolicyDefinition {
  clause_id: string;
  title: string;
  policy_text: string;
  issue_category: string;
  refund_type: 'partial' | 'full' | 'conditional' | 'review';
  policy_version: string;
}

export const PLATFORM_POLICIES: PolicyDefinition[] = [
  {
    clause_id: 'POL-01',
    title: 'Missing Items Policy',
    policy_text: 'Missing food or beverage items from an order qualify for a partial refund corresponding to the verified purchase price of the omitted item(s).',
    issue_category: 'missing_item',
    refund_type: 'partial',
    policy_version: 'v1.0',
  },
  {
    clause_id: 'POL-02',
    title: 'Wrong Items Policy',
    policy_text: 'If a customer receives an incorrect food item differing from the itemized order bill, they may qualify for a refund or replacement of the affected item.',
    issue_category: 'wrong_item',
    refund_type: 'partial',
    policy_version: 'v1.0',
  },
  {
    clause_id: 'POL-03',
    title: 'Damaged or Spilled Food Policy',
    policy_text: 'Food items that arrive damaged, crushed, or spilled during transit qualify for a partial or full refund depending on the severity of contamination or inedibility.',
    issue_category: 'damaged_spilled',
    refund_type: 'conditional',
    policy_version: 'v1.0',
  },
  {
    clause_id: 'POL-04',
    title: 'Dispute Reporting Window Policy',
    policy_text: 'Customers must report any eligible order defects or complaints within the specified reporting window of 24 hours from the authoritative delivery timestamp.',
    issue_category: 'reporting_window',
    refund_type: 'conditional',
    policy_version: 'v1.0',
  },
  {
    clause_id: 'POL-05',
    title: 'Refund Pricing & Item Cap Policy',
    policy_text: 'Approved refunds must strictly never exceed the eligible purchase amount paid for the affected items on the authoritative bill, nor exceed the total order amount.',
    issue_category: 'pricing_cap',
    refund_type: 'partial',
    policy_version: 'v1.0',
  },
  {
    clause_id: 'POL-06',
    title: 'Suspicious & High Frequency Policy',
    policy_text: 'Repeated refund requests, accounts with high dispute frequency exceeding normal platform thresholds, or suspicious claim patterns require escalation to human review.',
    issue_category: 'fraud_prevention',
    refund_type: 'review',
    policy_version: 'v1.0',
  },
  {
    clause_id: 'POL-07',
    title: 'Inconclusive Evidence Review Policy',
    policy_text: 'When photographic evidence is inconclusive (such as an exterior bag photo for missing items) or insufficient to establish fact, the case may require additional customer information or manual human review rather than automatic rejection.',
    issue_category: 'evidence_rule',
    refund_type: 'review',
    policy_version: 'v1.0',
  },
];

export async function seedPolicies() {
  console.log('[INFO] Ingesting simulated refund policies into PostgreSQL (pgvector)...');
  const client = await dbPool.connect();

  try {
    await client.query('BEGIN');

    for (const policy of PLATFORM_POLICIES) {
      console.log(`   Embedding clause: ${policy.clause_id} - ${policy.title}...`);
      const embeddingText = `${policy.clause_id} ${policy.title}: ${policy.policy_text} (Category: ${policy.issue_category}, Type: ${policy.refund_type})`;
      const embedding = await generateEmbedding(embeddingText);
      const vectorLiteral = formatVectorForPg(embedding);

      await client.query(
        `INSERT INTO policies 
          (clause_id, title, policy_text, issue_category, refund_type, policy_version, effective_from, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE, $7::vector)
         ON CONFLICT (clause_id) DO UPDATE SET
           title = EXCLUDED.title,
           policy_text = EXCLUDED.policy_text,
           issue_category = EXCLUDED.issue_category,
           refund_type = EXCLUDED.refund_type,
           policy_version = EXCLUDED.policy_version,
           embedding = EXCLUDED.embedding,
           created_at = NOW();`,
        [
          policy.clause_id,
          policy.title,
          policy.policy_text,
          policy.issue_category,
          policy.refund_type,
          policy.policy_version,
          vectorLiteral,
        ]
      );
    }

    await client.query('COMMIT');
    console.log(`[SUCCESS] Successfully seeded and embedded ${PLATFORM_POLICIES.length} policy clauses in pgvector!`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[ERROR] Failed to seed policies:', err);
    throw err;
  } finally {
    client.release();
  }
}

if (process.argv[1].endsWith('seedPolicies.ts') || process.argv[1].endsWith('seedPolicies.js')) {
  seedPolicies()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
