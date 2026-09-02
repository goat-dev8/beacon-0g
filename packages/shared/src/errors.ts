export type ErrorCode =
  | "NO_FIT"
  | "QUOTE_TIMEOUT"
  | "JOB_NOT_FOUND"
  | "OFFER_EXPIRED"
  | "INVALID_TRANSITION"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "VALIDATION"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_FAILED"
  | "SETTLE_FAILED"
  | "PIPELINE_FAILED"
  | "ACCEPT_FAILED"
  | "SERVICE_UNAVAILABLE"
  | "RATE_LIMITED"
  | "INTERNAL"
  | "NOT_READY"
  | "ARTIFACT_MISSING"
  | "CREDIT_PREP_FAILED"
  | "TEE_DENIED"
  | "SWAP_REFUSED"
  | "STORAGE_FAILED"
  | "COMPUTE_FAILED"
  | "INSUFFICIENT_TREASURY"
  | "HISTORY_PERSISTENCE_FAILED"
  | "ENV_INVALID";

const USER_MESSAGES: Record<ErrorCode, string> = {
  NO_FIT: "We can't take this job as described. Try simplifying the brief or choosing a different service.",
  QUOTE_TIMEOUT: "We couldn't prepare a quote in time. Please try again.",
  JOB_NOT_FOUND: "We couldn't find that job.",
  OFFER_EXPIRED: "This quote has expired. Request a new quote to continue.",
  INVALID_TRANSITION: "This action isn't available for the job right now.",
  UNAUTHORIZED: "Please sign in to continue.",
  FORBIDDEN: "You don't have access to this job.",
  VALIDATION: "Please check your input and try again.",
  PAYMENT_REQUIRED: "Work credit or approval is required before we can continue.",
  PAYMENT_FAILED: "We couldn't complete the payment step. You have not been charged.",
  SETTLE_FAILED: "We finished your job but couldn't finalize billing. Our team has been notified.",
  PIPELINE_FAILED: "We couldn't finish this job. You have not been charged.",
  ACCEPT_FAILED: "Quality checks did not pass. You have not been charged.",
  SERVICE_UNAVAILABLE: "Beacon is temporarily unavailable. Please try again shortly.",
  RATE_LIMITED: "Too many requests. Please wait a moment and try again.",
  INTERNAL: "Something went wrong on our side. Please try again.",
  NOT_READY: "Beacon is still starting up. Please try again in a moment.",
  ARTIFACT_MISSING: "The requested result isn't ready yet.",
  CREDIT_PREP_FAILED: "We couldn't prepare the add-credit flow. Please try again.",
  TEE_DENIED: "Beacon refused this action. Policy or verification did not allow it.",
  SWAP_REFUSED: "Beacon refused this swap because verified liquidity is insufficient.",
  STORAGE_FAILED: "We could not store evidence on 0G Storage. The job will not be marked complete.",
  COMPUTE_FAILED: "0G Compute did not return a usable result. You have not been charged for a pass.",
  INSUFFICIENT_TREASURY:
    "0G Compute treasury could not pay the provider. This is not your Safe balance. Escrow refunds.",
  HISTORY_PERSISTENCE_FAILED: "Chat could not be saved. Connect a wallet and try again.",
  ENV_INVALID: "This deployment is not configured for 0G Aristotle.",
};

function statusForCode(code: ErrorCode): number {
  switch (code) {
    case "UNAUTHORIZED":
      return 401;
    case "FORBIDDEN":
    case "TEE_DENIED":
      return 403;
    case "JOB_NOT_FOUND":
    case "ARTIFACT_MISSING":
      return 404;
    case "VALIDATION":
    case "NO_FIT":
    case "OFFER_EXPIRED":
    case "INVALID_TRANSITION":
    case "SWAP_REFUSED":
    case "ENV_INVALID":
      return 400;
    case "PAYMENT_REQUIRED":
      return 402;
    case "RATE_LIMITED":
      return 429;
    case "NOT_READY":
    case "SERVICE_UNAVAILABLE":
    case "INSUFFICIENT_TREASURY":
    case "HISTORY_PERSISTENCE_FAILED":
      return 503;
    default:
      return 500;
  }
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly userMessage: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(
    code: ErrorCode,
    options?: { message?: string; statusCode?: number; details?: unknown; cause?: unknown },
  ) {
    const userMessage = options?.message ?? USER_MESSAGES[code] ?? USER_MESSAGES.INTERNAL;
    super(userMessage, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.userMessage = userMessage;
    this.statusCode = options?.statusCode ?? statusForCode(code);
    this.details = options?.details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.userMessage,
      },
    };
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function userMessageForCode(code: ErrorCode): string {
  return USER_MESSAGES[code] ?? USER_MESSAGES.INTERNAL;
}
