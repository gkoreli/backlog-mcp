/** Deterministic external-model fixtures; Orama retrieval and memfs remain real (ADR 0134 R6.1). */
const DIMENSIONS = 384;
const TOPICS = [
  /authentication|login|oauth2|sso/i,
  /deployment|pipeline|ci\/cd|staging/i,
  /database|slow|quer(?:y|ies)|indexing/i,
  /profile|account|settings/i,
  /rate limiting|security|ddos|abuse|protect|api/i,
  /hurricane|flooding|tropical|storm|destruction|datacenter|disaster/i,
];

/** Known unit vectors isolate vector-lane contracts from model quality and downloads. */
export async function fixtureFeatureExtractionPipeline(task: string, model: string, options: { dtype: string }) {
  if (task !== 'feature-extraction' || model !== 'Xenova/all-MiniLM-L6-v2' || options.dtype !== 'fp32') {
    throw new Error('Unexpected embedding model contract');
  }
  return async function embed(text: string, options: { pooling: string; normalize: boolean }) {
    if (options.pooling !== 'mean' || options.normalize !== true) {
      throw new Error('Expected normalized mean pooling');
    }
    const data = new Float32Array(DIMENSIONS);
    const topic = TOPICS.findIndex(function matches(pattern) { return pattern.test(text); });
    data[topic === -1 ? TOPICS.length : topic] = 1;
    return { data };
  };
}
