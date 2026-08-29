"use client";

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