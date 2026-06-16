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
const { PolicyStatusRequestSchema, PolicyStatusResultSchema, CertificateResultSchema } =
  await import("@/contracts/policy.ts");

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
