export {
  ExecutionPhaseSchema,
  PaymentModeSchema,
  type ExecutionPhase,
  type PaymentMode,
  type ExecutionPlan,
  type PreparedExecution,
  type ExecutionEvidence,
  type VerificationResult,
  type ExecutionAdapter,
  type ExecutionEvent,
  type ExecutionEventType,
  type WorkflowDefinition,
} from "./types.js";

export {
  ALLOWED_TRANSITIONS,
  TERMINAL_PHASES,
  ExecutionTransitionError,
  assertTransition,
  canTransition,
  isTerminalPhase,
} from "./transitions.js";

export { hashImmutableInput } from "./hash.js";

export {
  preflightVaultCalls,
  SELECTOR_WETH_DEPOSIT,
  SELECTOR_ERC20_APPROVE,
  SELECTOR_EXACT_INPUT_SINGLE,
  type PreflightCall,
  type PreflightCheck,
  type PreflightDecision,
} from "./preflight.js";

export { WorkflowRegistry } from "./registry.js";

export {
  createInMemoryEventStore,
  appendExecutionEvent,
  getExecutionEvents,
  replayExecutionEvents,
  type InMemoryEventStore,
  type AppendExecutionEventInput,
} from "./events.js";
