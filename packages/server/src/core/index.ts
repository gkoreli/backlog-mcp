export { listItems } from './list.js';
export { getItems } from './get.js';
export { composeContextStubs } from './get-context/index.js';
export type { ComposeContextDeps, ContextStub, ContextStubs } from './get-context/index.js';
export { REQUIREMENT_TYPE, toConstraintStub, isActiveConstraint, compareConstraints } from './requirements/index.js';
export type { ConstraintStub, ConstraintViolations } from './requirements/index.js';
export { createEntity } from './create.js';
export { updateEntity } from './update.js';
export { deleteItem } from './delete.js';
export { searchItems } from './search.js';
export { editItem } from './edit.js';
export { wakeup } from './wakeup.js';
export { recall } from './recall.js';
export type { RecallDeps } from './recall.js';
export { recordMutation } from './operation-log.js';
export { NotFoundError, ValidationError } from './types.js';
export type {
  ListParams, ListItem, ListResult,
  GetParams, GetItem, GetResult,
  CreateEntityParams, CreateResult,
  UpdateEntityParams, UpdateResult,
  DeleteParams, DeleteResult,
  SearchParams, SearchResult, SearchResultItem,
  EditParams, EditResult,
  WakeupParams, WakeupResult, WakeupEntitySummary, WakeupCompletion, WakeupActivity,
  RecallParams, RecallResult, RecallItem,
  WriteContext, Actor, IOperationLog,
  MemoryLayer,
} from './types.js';
export {
  BACKLOG_CONTROL_DIR,
  BACKLOG_DOCUMENTS_DIR,
  BACKLOG_HOME_ENV_VAR,
  BACKLOG_HOME_HEADER,
  BACKLOG_PROJECT_ROOT_HEADER,
  BACKLOG_PROJECT_ROOT_ENV_VAR,
  BacklogHomeResolutionError,
  createBacklogHome,
  discoverProjectRoot,
  isPathWithin,
  resolveBacklogHome,
} from './backlog-home.js';
export type {
  BacklogHome,
  BacklogHomeDeps,
  BacklogHomeSelector,
  CreateBacklogHomeParams,
  DiscoverProjectRootParams,
  ResolveBacklogHomeParams,
} from './backlog-home.types.js';
export { discoverDocuments } from './document-discovery.js';
export type {
  DiscoverDocumentsParams,
  DiscoveredDocument,
  DiscoveredSubstrateDeclaration,
  DiscoveryChronology,
  DocumentDiscoveryDependencies,
  DocumentDiscoveryDiagnostic,
  DocumentDiscoveryDiagnosticCode,
  DocumentDiscoveryResult,
  DocumentDiscoveryStat,
  DocumentFormat,
} from './document-discovery.types.js';
export {
  normalizeDocumentSourcePath,
  parseDocumentIdentity,
} from './document-identity.js';
export type {
  DocumentDateSource,
  DocumentIdentity,
  ParseDocumentIdentityParams,
} from './document-identity.types.js';
export { createHomeReadCoordinator } from './home-read-coordinator.js';
export type {
  AvailableHomeReadStatus,
  CrossHomeItemProvenance,
  CrossHomeRecallItem,
  CrossHomeRecallResult,
  CrossHomeSearchResult,
  CrossHomeSearchResultItem,
  CrossHomeWakeupGroup,
  CrossHomeWakeupParams,
  CrossHomeWakeupResult,
  HomeReadCoordinator,
  HomeReadCoordinatorDependencies,
  HomeReadRuntime,
  HomeReadRuntimeResolver,
  HomeReadRuntimeSelection,
  HomeReadSelection,
  HomeReadStatus,
  HomeRecallDemandRecorder,
  UnavailableHomeReadStatus,
} from './home-read-coordinator.types.js';
export {
  claimSubstrateDocuments,
  compileSubstrateDefinition,
  createBuiltinSubstrateRegistrations,
  createProjectSubstrateRegistry,
  loadProjectSubstrateDefinitions,
  loadSubstrateDefinitions,
  ProjectSubstrateRegistry,
} from './substrates/index.js';
export type {
  ClaimedSubstrateDocument,
  ClaimSubstrateDocumentsParams,
  ClaimSubstrateDocumentsResult,
  CompiledBuiltinSubstrate,
  CompiledSubstrateDefinition,
  CompileSubstrateDefinitionParams,
  CompileSubstrateDefinitionResult,
  CreateProjectSubstrateRegistryParams,
  CreateProjectSubstrateRegistryResult,
  LoadSubstrateDefinitionsParams,
  LoadSubstrateDefinitionsResult,
  RegisteredSubstrate,
  SubstrateClaimSource,
  SubstrateDocumentCollisionDiagnostic,
  SubstrateDefinitionDiagnostic,
  SubstrateDefinitionIssue,
  SubstrateDefinitionIssueCode,
  SubstrateWriteValidationResult,
} from './substrates/index.js';
