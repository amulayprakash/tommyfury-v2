/**
 * Generates openapi/openapi.json from the zod contract schemas.
 * Run: npm run openapi:gen
 *
 * NOTE: extendZodWithOpenApi must run BEFORE the contract schemas are created,
 * so the schema modules are imported dynamically after the extend call.
 */

import {
  OpenApiGeneratorV3,
  OpenAPIRegistry,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

extendZodWithOpenApi(z);

const { MotorQuoteRequestSchema, MotorFullQuoteRequestSchema, CompareQuotesRequestSchema } =
  await import("@/contracts/quote-request.ts");
const { CanonicalQuoteResultSchema } = await import("@/contracts/quote-result.ts");
const { ProvidersResponseSchema, CompareResponseDataSchema } = await import(
  "@/contracts/provider-meta.ts"
);
const { CkycRequestObjectSchema, KycResultSchema, OvdResultSchema } = await import(
  "@/contracts/kyc.ts"
);
const {
  PolicyStatusRequestSchema,
  PolicyStatusResultSchema,
  CertificateResultSchema,
  PolicyIssuanceRequestSchema,
  PolicyIssuanceResultSchema,
  PaymentInitiateRequestSchema,
} = await import("@/contracts/policy.ts");
const { RenewalQuoteRequestSchema, RenewalCreatePolicyRequestSchema } = await import(
  "@/contracts/renewal.ts"
);
const { InspectionRequestSchema, InspectionResultSchema } = await import("@/contracts/inspection.ts");
const {
  HealthQuoteRequestSchema,
  HealthFullQuoteRequestSchema,
  HealthCompareRequestSchema,
} = await import("@/contracts/health/health-quote-request.ts");
const { HealthIssuanceRequestSchema } = await import("@/contracts/health/health-policy.ts");
const { HealthQuoteResultSchema } = await import("@/contracts/health/health-quote-result.ts");

const registry = new OpenAPIRegistry();

registry.register("MotorQuoteRequest", MotorQuoteRequestSchema);
registry.register("MotorFullQuoteRequest", MotorFullQuoteRequestSchema);
registry.register("CompareQuotesRequest", CompareQuotesRequestSchema);
registry.register("CanonicalQuoteResult", CanonicalQuoteResultSchema);
registry.register("ProvidersResponse", ProvidersResponseSchema);
registry.register("CompareResponseData", CompareResponseDataSchema);
registry.register("CkycRequest", CkycRequestObjectSchema);
registry.register("KycResult", KycResultSchema);
registry.register("OvdResult", OvdResultSchema);
registry.register("PolicyStatusRequest", PolicyStatusRequestSchema);
registry.register("PolicyStatusResult", PolicyStatusResultSchema);
registry.register("CertificateResult", CertificateResultSchema);
registry.register("PolicyIssuanceRequest", PolicyIssuanceRequestSchema);
registry.register("PolicyIssuanceResult", PolicyIssuanceResultSchema);
registry.register("PaymentInitiateRequest", PaymentInitiateRequestSchema);
registry.register("RenewalQuoteRequest", RenewalQuoteRequestSchema);
registry.register("RenewalCreatePolicyRequest", RenewalCreatePolicyRequestSchema);
registry.register("InspectionRequest", InspectionRequestSchema);
registry.register("InspectionResult", InspectionResultSchema);
registry.register("HealthQuoteRequest", HealthQuoteRequestSchema);
registry.register("HealthFullQuoteRequest", HealthFullQuoteRequestSchema);
registry.register("HealthCompareRequest", HealthCompareRequestSchema);
registry.register("HealthIssuanceRequest", HealthIssuanceRequestSchema);
registry.register("HealthQuoteResult", HealthQuoteResultSchema);

const providerParam = z.object({ provider: z.string().openapi({ example: "icici" }) });

registry.registerPath({
  method: "get",
  path: "/api/v1/providers",
  summary: "List registered providers with their capability matrix",
  responses: {
    200: {
      description: "Providers",
      content: { "application/json": { schema: ProvidersResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/motor/quotes/compare",
  summary: "Compare quotes — fan out to every eligible provider in parallel",
  request: {
    body: { content: { "application/json": { schema: CompareQuotesRequestSchema } } },
  },
  responses: {
    200: {
      description: "Per-provider quote results",
      content: { "application/json": { schema: CompareResponseDataSchema } },
    },
    422: { description: "Validation error" },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/{provider}/motor/quote",
  summary: "Save quote — get motor premium from a provider",
  request: {
    params: providerParam,
    body: { content: { "application/json": { schema: MotorQuoteRequestSchema } } },
  },
  responses: {
    200: { description: "Quote fetched", content: { "application/json": { schema: CanonicalQuoteResultSchema } } },
    422: { description: "Validation / unsupported category" },
    404: { description: "Unknown provider" },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/{provider}/motor/quote/{transactionId}",
  summary: "Retrieve a previously saved quote by transaction id",
  request: {
    params: z.object({
      provider: z.string().openapi({ example: "icici" }),
      transactionId: z.string(),
    }),
    query: z.object({ category: z.string().openapi({ example: "fourWheeler" }) }),
  },
  responses: {
    200: { description: "Quote", content: { "application/json": { schema: CanonicalQuoteResultSchema } } },
    422: { description: "Validation / unsupported operation" },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/{provider}/motor/full-quote",
  summary: "Proposal — bind a quote into a policy",
  request: {
    params: providerParam,
    body: { content: { "application/json": { schema: MotorFullQuoteRequestSchema } } },
  },
  responses: {
    200: { description: "Proposal result", content: { "application/json": { schema: CanonicalQuoteResultSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/{provider}/kyc/ckyc",
  summary: "CKYC (PAN / CKYC number / Aadhaar)",
  request: {
    params: providerParam,
    body: { content: { "application/json": { schema: CkycRequestObjectSchema } } },
  },
  responses: {
    200: { description: "KYC result", content: { "application/json": { schema: KycResultSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/{provider}/kyc/ovd",
  summary: "OVD KYC — upload identity & address proofs (multipart/form-data)",
  request: { params: providerParam },
  responses: {
    200: { description: "OVD result", content: { "application/json": { schema: OvdResultSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/{provider}/policy/status",
  summary: "Poll policy status",
  request: {
    params: providerParam,
    body: { content: { "application/json": { schema: PolicyStatusRequestSchema } } },
  },
  responses: {
    200: { description: "Policy status", content: { "application/json": { schema: PolicyStatusResultSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/{provider}/policy/{transactionId}/certificate",
  summary: "Fetch the Certificate of Insurance (base64 PDF)",
  request: {
    params: z.object({
      provider: z.string().openapi({ example: "icici" }),
      transactionId: z.string(),
    }),
  },
  responses: {
    200: { description: "COI", content: { "application/json": { schema: CertificateResultSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/{provider}/policy/issue",
  summary: "Issue the policy — bind payment to the proposal (FG PolicyIssuance)",
  request: {
    params: providerParam,
    body: { content: { "application/json": { schema: PolicyIssuanceRequestSchema } } },
  },
  responses: {
    200: { description: "Issuance result", content: { "application/json": { schema: PolicyIssuanceResultSchema } } },
    422: { description: "Validation / unsupported operation" },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/{provider}/payment/initiate",
  summary: "Build the checksum-signed payment-gateway form",
  request: {
    params: providerParam,
    body: { content: { "application/json": { schema: PaymentInitiateRequestSchema } } },
  },
  responses: {
    200: { description: "Signed gateway form (url + fields)" },
    501: { description: "Provider has no payment integration" },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/{provider}/motor/renewal/quote",
  summary: "Renewal quote — price an existing policy (FG motorRenewal)",
  request: {
    params: providerParam,
    body: { content: { "application/json": { schema: RenewalQuoteRequestSchema } } },
  },
  responses: {
    200: { description: "Renewal quote", content: { "application/json": { schema: CanonicalQuoteResultSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/{provider}/motor/renewal/create",
  summary: "Renewal create — issue the renewed policy with the payment receipt",
  request: {
    params: providerParam,
    body: { content: { "application/json": { schema: RenewalCreatePolicyRequestSchema } } },
  },
  responses: {
    200: { description: "Issuance result", content: { "application/json": { schema: PolicyIssuanceResultSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/{provider}/inspection",
  summary: "Create a break-in / pre-inspection request",
  request: {
    params: providerParam,
    body: { content: { "application/json": { schema: InspectionRequestSchema } } },
  },
  responses: {
    200: { description: "Inspection created", content: { "application/json": { schema: InspectionResultSchema } } },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/v1/{provider}/inspection/{refId}/status",
  summary: "Poll a break-in inspection's status",
  request: {
    params: z.object({ provider: z.string(), refId: z.string() }),
  },
  responses: {
    200: { description: "Inspection status", content: { "application/json": { schema: InspectionResultSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/health/quotes/compare",
  summary: "Compare health quotes — fan out one member set across products/providers",
  request: {
    body: { content: { "application/json": { schema: HealthCompareRequestSchema } } },
  },
  responses: {
    200: { description: "Per-product health quote results" },
    422: { description: "Validation error" },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/{provider}/health/quote",
  summary: "Health quote — price a product for the given members",
  request: {
    params: providerParam,
    body: { content: { "application/json": { schema: HealthQuoteRequestSchema } } },
  },
  responses: {
    200: { description: "Health quote", content: { "application/json": { schema: HealthQuoteResultSchema } } },
    422: { description: "Validation / unsupported product" },
    404: { description: "Unknown provider" },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/{provider}/health/full-quote",
  summary: "Health proposal — validate the full proposal (HealthPreCRTValidate)",
  request: {
    params: providerParam,
    body: { content: { "application/json": { schema: HealthFullQuoteRequestSchema } } },
  },
  responses: {
    200: { description: "Proposal result", content: { "application/json": { schema: HealthQuoteResultSchema } } },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/v1/{provider}/health/issue",
  summary: "Issue the health policy — full payload + payment receipt",
  request: {
    params: providerParam,
    body: { content: { "application/json": { schema: HealthIssuanceRequestSchema } } },
  },
  responses: {
    200: { description: "Issuance result", content: { "application/json": { schema: PolicyIssuanceResultSchema } } },
    422: { description: "Validation / unsupported operation" },
  },
});

const generator = new OpenApiGeneratorV3(registry.definitions);
const doc = generator.generateDocument({
  openapi: "3.0.0",
  info: { title: "Tommy & Furry Vendor API", version: "1.0.0" },
  servers: [{ url: "/api/v1" }],
});

const outDir = resolve(process.cwd(), "openapi");
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "openapi.json"), JSON.stringify(doc, null, 2));
console.log("openapi/openapi.json generated.");
