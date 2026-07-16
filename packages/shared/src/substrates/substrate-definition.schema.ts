import { z } from 'zod';

export const SUBSTRATE_DEFINITION_SCHEMA_URI =
  'urn:backlog-mcp:schema:substrate-definition:1' as const;

const SUBSTRATE_TYPE_PATTERN = /^[a-z][a-z0-9-]*$/u;
const FIELD_NAME_PATTERN = /^[a-z][a-z0-9_]*$/u;
const INTENT_VERB_PATTERN = /^[a-z][a-z0-9_]*$/u;
const TOOL_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/u;
const IDENTITY_PREFIX_PATTERN = /^[A-Z][A-Z0-9]*$/u;
const DISPLAY_TEMPLATE_PATTERN = /^[^{}]*\{key\}[^{}]*$/u;

const StorageIdentityBaseSchema = z.object({
  minimumDigits: z.number().int().min(1).max(12).optional(),
  displayTemplate: z.string().min(5).max(80)
    .regex(DISPLAY_TEMPLATE_PATTERN, 'displayTemplate must contain one {key} placeholder')
    .optional(),
});

const NumberedIdentitySchema = StorageIdentityBaseSchema.extend({
  strategy: z.literal('numbered'),
}).strict();

const NumberedThreadedIdentitySchema = StorageIdentityBaseSchema.extend({
  strategy: z.literal('numbered-threaded'),
}).strict();

const PrefixedNumberIdentitySchema = StorageIdentityBaseSchema.extend({
  strategy: z.literal('prefixed-number'),
  prefix: z.string().min(1).max(16).regex(IDENTITY_PREFIX_PATTERN),
}).strict();

/** Version-one identity policies understood by docs-native storage. */
export const SubstrateIdentityDefinitionSchema = z.discriminatedUnion('strategy', [
  NumberedIdentitySchema,
  NumberedThreadedIdentitySchema,
  PrefixedNumberIdentitySchema,
]);

const FieldNameSchema = z.string().min(1).max(80).regex(FIELD_NAME_PATTERN);
const WorkflowStateSchema = z.union([
  z.string().min(1).max(80),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
const InputNamesSchema = z.array(FieldNameSchema).max(64);

export const SubstrateWorkflowTransitionDefinitionSchema = z.object({
  name: z.string().min(1).max(80).regex(INTENT_VERB_PATTERN),
  from: z.array(WorkflowStateSchema).min(1).max(64),
  to: WorkflowStateSchema,
  requiresRelation: FieldNameSchema.optional(),
}).strict();

export const SubstrateWorkflowDefinitionSchema = z.object({
  field: FieldNameSchema,
  initial: z.array(WorkflowStateSchema).min(1).max(64),
  terminal: z.array(WorkflowStateSchema).max(64).optional(),
  transitions: z.array(SubstrateWorkflowTransitionDefinitionSchema).max(64),
}).strict();

export const SubstrateRelationDefinitionSchema = z.object({
  targets: z.array(
    z.string().min(1).max(64).regex(SUBSTRATE_TYPE_PATTERN),
  ).min(1).max(64),
  cardinality: z.enum(['one', 'zero-or-one', 'many']),
  inverse: FieldNameSchema.optional(),
}).strict();

const RuntimeSubstrateIntentBaseSchema = z.object({
  verb: z.string().min(1).max(80).regex(INTENT_VERB_PATTERN),
  toolName: z.string().min(1).max(128).regex(TOOL_NAME_PATTERN).optional(),
  description: z.string().trim().min(1).max(1_000),
  requiredInputs: InputNamesSchema,
  optionalInputs: InputNamesSchema.optional(),
  defaults: z.record(FieldNameSchema, z.json()).optional(),
});

export const RuntimeSubstrateIntentDefinitionSchema = z.discriminatedUnion(
  'operation',
  [
    RuntimeSubstrateIntentBaseSchema.extend({
      operation: z.literal('create'),
    }).strict(),
    RuntimeSubstrateIntentBaseSchema.extend({
      operation: z.literal('transition'),
      transition: z.string().min(1).max(80).regex(INTENT_VERB_PATTERN),
    }).strict(),
    RuntimeSubstrateIntentBaseSchema.extend({
      operation: z.literal('set-field'),
      field: FieldNameSchema,
      value: WorkflowStateSchema,
    }).strict(),
    RuntimeSubstrateIntentBaseSchema.extend({
      operation: z.literal('relate'),
      relation: FieldNameSchema,
      sourceInput: FieldNameSchema,
      targetInput: FieldNameSchema,
    }).strict(),
    RuntimeSubstrateIntentBaseSchema.extend({
      operation: z.literal('append-relation'),
      relation: FieldNameSchema,
      sourceInput: FieldNameSchema,
      targetInput: FieldNameSchema,
    }).strict(),
    RuntimeSubstrateIntentBaseSchema.extend({
      operation: z.literal('relate-and-transition'),
      relation: FieldNameSchema,
      sourceInput: FieldNameSchema,
      targetInput: FieldNameSchema,
      targetTransition: z.string().min(1).max(80).regex(INTENT_VERB_PATTERN),
    }).strict(),
  ],
);

/** Strict version-one envelope for project-authored substrate definitions. */
export const RuntimeSubstrateDefinitionSchema = z.object({
  $schema: z.literal(SUBSTRATE_DEFINITION_SCHEMA_URI).optional(),
  definitionVersion: z.literal(1),
  type: z.string().min(1).max(64).regex(SUBSTRATE_TYPE_PATTERN),
  label: z.object({
    singular: z.string().trim().min(1).max(80),
    plural: z.string().trim().min(1).max(80),
  }).strict(),
  folder: z.string().min(1).max(240),
  identity: SubstrateIdentityDefinitionSchema,
  schema: z.record(z.string(), z.unknown()),
  workflow: SubstrateWorkflowDefinitionSchema.optional(),
  relations: z.record(FieldNameSchema, SubstrateRelationDefinitionSchema).optional(),
  intents: z.array(RuntimeSubstrateIntentDefinitionSchema).max(64).optional(),
  replaces: z.string().min(1).max(160).optional(),
}).strict();

/** JSON Schema projection used by editors and declaration tooling. */
export const RuntimeSubstrateDefinitionJsonSchema = z.toJSONSchema(
  RuntimeSubstrateDefinitionSchema,
);

export type SubstrateIdentityDefinition =
  z.infer<typeof SubstrateIdentityDefinitionSchema>;

export type RuntimeSubstrateDefinition =
  z.infer<typeof RuntimeSubstrateDefinitionSchema>;

export type RuntimeSubstrateIntentDefinition =
  z.infer<typeof RuntimeSubstrateIntentDefinitionSchema>;

export type SubstrateWorkflowDefinition =
  z.infer<typeof SubstrateWorkflowDefinitionSchema>;

export type SubstrateWorkflowTransitionDefinition =
  z.infer<typeof SubstrateWorkflowTransitionDefinitionSchema>;

export type SubstrateRelationDefinition =
  z.infer<typeof SubstrateRelationDefinitionSchema>;
