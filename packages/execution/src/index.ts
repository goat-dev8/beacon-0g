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

export { hashImmutableInput, canonicalize } from "./hash.js";

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

export { bindAction, hashPolicySnapshot, hashTeeVerdict, hashUtf8 } from "./actionProof.js";
export type { ActionBinding, ActionBindingInput } from "./actionProof.js";

export { classifyRisk, AUTO_SWAP_WEI } from "./risk.js";
export type { RiskDecision, RiskFactor, RiskInput, RiskTier } from "./risk.js";

export { aggregateGuards } from "./guards.js";
export type { GuardMode, GuardReport, GuardVote } from "./guards.js";
