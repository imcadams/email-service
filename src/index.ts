import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const SES_REGION = process.env.SES_AWS_REGION || process.env.AWS_REGION || "us-east-1";
const FIXED_FROM_ADDRESS = process.env.FIXED_FROM_ADDRESS || "info@mcadamsdevelopment.com";
const FIXED_TO_ADDRESS = process.env.FIXED_TO_ADDRESS || "info@mcadamsdevelopment.com";
const TURNSTILE_SECRET_ID =
  process.env.TURNSTILE_SECRET_ID || "mcadams-development/turnstile-secret-key";
const TURNSTILE_ALLOWED_HOSTNAME =
  process.env.TURNSTILE_ALLOWED_HOSTNAME || "www.mcadamsdevelopment.com";
const TURNSTILE_ACTION = "contact";
const TURNSTILE_TIMEOUT_MS = 3_000;
const SECRET_CACHE_MS = 5 * 60 * 1_000;
const MIN_FORM_AGE_MS = 3_000;
const MAX_FORM_AGE_MS = 2 * 60 * 60 * 1_000;
const MAX_REQUEST_BYTES = 32 * 1024;

const allowedOrigins = new Set([
  "https://www.mcadamsdevelopment.com",
  "https://mcadamsdevelopment.com",
]);

const serviceInterests = new Set([
  "website",
  "webapp",
  "mobile",
  "cloud",
  "devops",
  "design",
  "ai-receptionist",
]);

const budgets = new Set([
  "under5k",
  "5k-15k",
  "15k-25k",
  "25k-50k",
  "50kplus",
]);

const supportedSolutions = new Set(["hvac-ai-receptionist"]);

export interface ContactRequest {
  name: string;
  email: string;
  phone: string;
  serviceInterest: string;
  budget: string;
  description: string;
  sourceSolution?: string;
  turnstileToken: string;
  website?: string;
  formStartedAt: number;
}

interface TurnstileResult {
  success: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
}

interface VerificationInput {
  secret: string;
  token: string;
  remoteIp?: string;
}

export interface ContactDependencies {
  now: () => number;
  getTurnstileSecret: () => Promise<string>;
  verifyTurnstile: (input: VerificationInput) => Promise<TurnstileResult>;
  sendEmail: (request: ContactRequest) => Promise<void>;
  log: (requestId: string, outcome: string) => void;
}

const sesClient = new SESClient({ region: SES_REGION });
const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION || "us-east-1" });

let secretCache: { value: string; expiresAt: number } | undefined;

function stringField(
  value: unknown,
  field: string,
  minLength: number,
  maxLength: number,
): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }

  const normalized = value.trim();
  if (normalized.length < minLength || normalized.length > maxLength) {
    throw new Error(`${field} is outside the allowed length`);
  }

  return normalized;
}

function parseContactRequest(value: unknown): ContactRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("request body must be an object");
  }

  const input = value as Record<string, unknown>;
  const email = stringField(input.email, "email", 3, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("email is invalid");
  }

  const phone = stringField(input.phone, "phone", 10, 30);
  const serviceInterest = stringField(input.serviceInterest, "serviceInterest", 1, 40);
  const budget = stringField(input.budget, "budget", 1, 40);

  if (!serviceInterests.has(serviceInterest)) {
    throw new Error("serviceInterest is invalid");
  }
  if (!budgets.has(budget)) {
    throw new Error("budget is invalid");
  }

  const sourceSolution =
    input.sourceSolution === undefined
      ? undefined
      : stringField(input.sourceSolution, "sourceSolution", 1, 80);
  if (sourceSolution && !supportedSolutions.has(sourceSolution)) {
    throw new Error("sourceSolution is invalid");
  }

  if (typeof input.formStartedAt !== "number" || !Number.isFinite(input.formStartedAt)) {
    throw new Error("formStartedAt is invalid");
  }

  return {
    name: stringField(input.name, "name", 2, 100),
    email,
    phone,
    serviceInterest,
    budget,
    description: stringField(input.description, "description", 10, 10_000),
    sourceSolution,
    turnstileToken: stringField(input.turnstileToken, "turnstileToken", 1, 4_096),
    website:
      input.website === undefined || input.website === ""
        ? ""
        : stringField(input.website, "website", 1, 200),
    formStartedAt: input.formStartedAt,
  };
}

function corsHeaders(origin: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Content-Type": "application/json",
    Vary: "Origin",
  };

  if (origin && allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function response(
  statusCode: number,
  headers: Record<string, string>,
  message: string,
): APIGatewayProxyResult {
  return {
    statusCode,
    headers,
    body: JSON.stringify({ message }),
  };
}

function defaultLog(requestId: string, outcome: string): void {
  console.log(JSON.stringify({ requestId, outcome }));
}

async function getTurnstileSecret(): Promise<string> {
  const now = Date.now();
  if (secretCache && secretCache.expiresAt > now) {
    return secretCache.value;
  }

  const secret = await secretsClient.send(
    new GetSecretValueCommand({ SecretId: TURNSTILE_SECRET_ID }),
  );
  const value = secret.SecretString;

  if (!value) {
    throw new Error("Turnstile secret is not configured");
  }

  secretCache = { value, expiresAt: now + SECRET_CACHE_MS };
  return value;
}

async function verifyTurnstile(input: VerificationInput): Promise<TurnstileResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);

  try {
    const body = new URLSearchParams({
      secret: input.secret,
      response: input.token,
    });
    if (input.remoteIp) {
      body.set("remoteip", input.remoteIp);
    }

    const verification = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: controller.signal,
      },
    );

    if (!verification.ok) {
      throw new Error("Turnstile verification service failed");
    }

    return (await verification.json()) as TurnstileResult;
  } finally {
    clearTimeout(timeout);
  }
}

function emailBody(request: ContactRequest): string {
  return [
    "New contact form submission",
    "",
    `Name: ${request.name}`,
    `Email: ${request.email}`,
    `Phone: ${request.phone}`,
    `Service interest: ${request.serviceInterest}`,
    `Budget: ${request.budget}`,
    `Source solution: ${request.sourceSolution || "general contact form"}`,
    "",
    "Project description:",
    request.description,
  ].join("\n");
}

async function sendEmail(request: ContactRequest): Promise<void> {
  await sesClient.send(
    new SendEmailCommand({
      Destination: { ToAddresses: [FIXED_TO_ADDRESS] },
      Message: {
        Body: { Text: { Data: emailBody(request), Charset: "UTF-8" } },
        Subject: {
          Data: `Contact form: ${request.serviceInterest}`,
          Charset: "UTF-8",
        },
      },
      ReplyToAddresses: [request.email],
      Source: FIXED_FROM_ADDRESS,
    }),
  );
}

const defaultDependencies: ContactDependencies = {
  now: Date.now,
  getTurnstileSecret,
  verifyTurnstile,
  sendEmail,
  log: defaultLog,
};

export function createHandler(dependencies: ContactDependencies = defaultDependencies) {
  return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const requestId = event.requestContext?.requestId || "unknown";
    const origin = event.headers?.origin || event.headers?.Origin;
    const headers = corsHeaders(origin);

    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers, body: "" };
    }

    if (event.httpMethod !== "POST" || !event.path.endsWith("/contact")) {
      dependencies.log(requestId, "NOT_FOUND");
      return response(404, headers, "Not found");
    }

    if (origin && !allowedOrigins.has(origin)) {
      dependencies.log(requestId, "ORIGIN_REJECTED");
      return response(403, headers, "Request rejected");
    }

    const contentType = event.headers?.["content-type"] || event.headers?.["Content-Type"];
    if (!contentType?.toLowerCase().startsWith("application/json")) {
      dependencies.log(requestId, "CONTENT_TYPE_REJECTED");
      return response(400, headers, "Invalid request");
    }

    if (!event.body || Buffer.byteLength(event.body, "utf8") > MAX_REQUEST_BYTES) {
      dependencies.log(requestId, "BODY_REJECTED");
      return response(400, headers, "Invalid request");
    }

    let request: ContactRequest;
    try {
      request = parseContactRequest(JSON.parse(event.body));
    } catch {
      dependencies.log(requestId, "VALIDATION_REJECTED");
      return response(400, headers, "Invalid request");
    }

    const formAge = dependencies.now() - request.formStartedAt;
    if (request.website || (formAge >= 0 && formAge < MIN_FORM_AGE_MS)) {
      dependencies.log(requestId, "BOT_SIGNAL_ACCEPTED");
      return response(202, headers, "Request accepted");
    }
    if (formAge < 0 || formAge > MAX_FORM_AGE_MS) {
      dependencies.log(requestId, "FORM_AGE_REJECTED");
      return response(400, headers, "Invalid request");
    }

    try {
      const secret = await dependencies.getTurnstileSecret();
      const verification = await dependencies.verifyTurnstile({
        secret,
        token: request.turnstileToken,
        remoteIp: event.requestContext?.identity?.sourceIp,
      });

      if (
        !verification.success ||
        verification.hostname !== TURNSTILE_ALLOWED_HOSTNAME ||
        verification.action !== TURNSTILE_ACTION
      ) {
        dependencies.log(requestId, "TURNSTILE_REJECTED");
        return response(422, headers, "Verification failed; please try again");
      }

      await dependencies.sendEmail(request);
      dependencies.log(requestId, "CONTACT_SENT");
      return response(202, headers, "Request accepted");
    } catch {
      dependencies.log(requestId, "PROVIDER_FAILED");
      return response(502, headers, "Unable to process request; please try again");
    }
  };
}

export const handler = createHandler();
