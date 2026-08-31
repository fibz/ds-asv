import fs from "fs";
import path from "path";
import yaml from "js-yaml";

let cachedSpec: OpenAPISpec | null = null;

export interface OpenAPISpec {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, Operation>>;
  components: {
    schemas: Record<string, Schema>;
    securitySchemes: Record<string, SecurityScheme>;
  };
}

export interface Operation {
  tags: string[];
  summary: string;
  operationId: string;
  parameters?: Parameter[];
  requestBody?: {
    content: {
      "application/json": { schema?: Schema };
    };
  };
  responses: Record<string, Response>;
  security?: Array<Record<string, string[]>>;
}

export interface Parameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  schema?: Schema;
}

export interface Schema {
  type?: string;
  properties?: Record<string, Schema>;
  items?: Schema;
  example?: unknown;
  $ref?: string;
}

export interface Response {
  description: string;
  content?: {
    "application/json": { schema?: Schema };
  };
}

export interface SecurityScheme {
  type: string;
  in?: string;
  name?: string;
}

/**
 * Server-side only: loads and parses the OpenAPI spec from disk.
 * Use this in API routes and server components.
 */
export function loadSpec(): OpenAPISpec {
  if (cachedSpec) return cachedSpec;

  const specPath = path.join(process.cwd(), "spec", "openapi.yaml");
  const file = fs.readFileSync(specPath, "utf-8");
  const parsed = yaml.load(file) as {
    components?: {
      schemas?: Record<string, unknown>;
    };
    paths?: Record<string, unknown>;
  };

  // Resolve $refs in schemas
  const resolveRefs = (obj: unknown): unknown => {
    if (typeof obj === "object" && obj !== null) {
      if (Array.isArray(obj)) {
        return obj.map(resolveRefs);
      }
      if ("$ref" in obj && typeof (obj as { $ref: string }).$ref === "string") {
        const ref = (obj as { $ref: string }).$ref;
        if (ref.startsWith("#/components/schemas/")) {
          const schemaName = ref.replace("#/components/schemas/", "");
          return resolveRefs(parsed.components?.schemas?.[schemaName] || {});
        }
      }
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        out[k] = resolveRefs(v);
      }
      return out;
    }
    return obj;
  };

  const resolved = resolveRefs(parsed) as OpenAPISpec;
  cachedSpec = resolved;
  return cachedSpec;
}

export function getOperationsByTag(spec: OpenAPISpec): Record<string, Array<{ path: string; method: string; operation: Operation }>> {
  const byTag: Record<string, Array<{ path: string; method: string; operation: Operation }>> = {};

  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      for (const tag of operation.tags || ["Untagged"]) {
        if (!byTag[tag]) byTag[tag] = [];
        byTag[tag].push({ path, method: method.toUpperCase(), operation });
      }
    }
  }

  return byTag;
}

export function getAllOperations(spec: OpenAPISpec): Array<{ path: string; method: string; operation: Operation }> {
  const ops: Array<{ path: string; method: string; operation: Operation }> = [];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      ops.push({ path, method: method.toUpperCase(), operation });
    }
  }
  return ops;
}