import { z } from 'zod';

export const SUBSTRATE_DEFINITION_SCHEMA_URI =
  'urn:backlog-mcp:schema:substrate-definition:1' as const;

const SUBSTRATE_TYPE_PATTERN = /^[a-z][a-z0-9-]*$/u;
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
