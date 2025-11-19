import { z } from "zod";

// Base schemas
export const HexStringSchema = z.string().regex(/^0x[0-9a-fA-F]+$/);

// Keep the original template literal type for compile-time type safety
// while using the schema for runtime validation
export type HexString = `0x${string}`;
