import { ValidationError } from "@/errors/app-error.ts";

/**
 * Asserts that a provider's own mandatory fields are present on a request whose
 * schema marks them optional.
 *
 * Some canonical contracts (notably the renewal ones) carry fields only certain
 * vendors need. Making them required at the schema level would block every other
 * vendor; dropping the check entirely would turn a missing field into an opaque
 * vendor error. Providers call this at the top of their mappers instead.
 */
export function requireFields<T extends object>(
  req: T,
  fields: readonly (keyof T & string)[],
  providerSlug: string,
): void {
  const missing = fields.filter((f) => {
    const v = req[f];
    return v === undefined || v === null || v === "";
  });
  if (missing.length === 0) return;
  throw new ValidationError(
    missing.map((f) => ({
      path: [f],
      message: `"${f}" is required for provider "${providerSlug}"`,
    })),
  );
}
