export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code: string = "INTERNAL_ERROR",
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown) {
    super(422, "Validation failed", "VALIDATION_ERROR", details);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(404, `${resource} not found`, "NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class ProviderError extends AppError {
  constructor(
    public readonly providerSlug: string,
    public readonly upstreamStatus: number,
    message: string,
    details?: unknown,
  ) {
    super(502, message, "PROVIDER_ERROR", details);
    this.name = "ProviderError";
  }
}

export class ProviderCapabilityError extends AppError {
  constructor(providerSlug: string, vehicleCategory: string) {
    super(
      422,
      `Provider "${providerSlug}" does not support category "${vehicleCategory}"`,
      "PROVIDER_CAPABILITY_ERROR",
    );
    this.name = "ProviderCapabilityError";
  }
}
