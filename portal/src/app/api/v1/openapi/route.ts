import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

export async function GET() {
  const specPath = path.join(process.cwd(), "spec", "openapi.yaml");
  const file = fs.readFileSync(specPath, "utf-8");
  const spec = yaml.load(file);
  return NextResponse.json(spec);
}