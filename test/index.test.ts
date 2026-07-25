import { APIGatewayProxyEvent } from "aws-lambda";
import {
  ContactDependencies,
  ContactRequest,
  createHandler,
} from "../src/index";

const now = 1_800_000_000_000;

function validBody(): ContactRequest {
  return {
    name: "Jane Customer",
    email: "jane@example.com",
    phone: "470-555-0100",
    serviceInterest: "ai-receptionist",
    budget: "5k-15k",
    description: "I would like to discuss an AI receptionist for my business.",
    sourceSolution: "hvac-ai-receptionist",
    turnstileToken: "valid-token",
    website: "",
    formStartedAt: now - 5_000,
  };
}

function event(body: unknown = validBody()): APIGatewayProxyEvent {
  return {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
      Origin: "https://www.mcadamsdevelopment.com",
    },
    multiValueHeaders: {},
    httpMethod: "POST",
    isBase64Encoded: false,
    path: "/contact",
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    resource: "/contact",
    requestContext: {
      accountId: "957356740227",
      apiId: "ien7fa5vj6",
      authorizer: null,
      protocol: "HTTP/1.1",
      httpMethod: "POST",
      identity: {
        accessKey: null,
        accountId: null,
        apiKey: null,
        apiKeyId: null,
        caller: null,
        clientCert: null,
        cognitoAuthenticationProvider: null,
        cognitoAuthenticationType: null,
        cognitoIdentityId: null,
        cognitoIdentityPoolId: null,
        principalOrgId: null,
        sourceIp: "203.0.113.10",
        user: null,
        userAgent: "jest",
        userArn: null,
      },
      path: "/prod/contact",
      stage: "prod",
      requestId: "request-123",
      requestTimeEpoch: now,
      resourceId: "contact",
      resourcePath: "/contact",
    },
  };
}

function dependencies(): jest.Mocked<ContactDependencies> {
  return {
    now: jest.fn(() => now),
    getTurnstileSecret: jest.fn(async () => "secret"),
    verifyTurnstile: jest.fn(async (_input) => ({
      success: true,
      hostname: "www.mcadamsdevelopment.com",
      action: "contact",
    })),
    sendEmail: jest.fn(async (_request: ContactRequest) => undefined),
    log: jest.fn(),
  };
}

describe("contact handler", () => {
  test("accepts a valid verified request and sends exactly one email", async () => {
    const deps = dependencies();
    const result = await createHandler(deps)(event());

    expect(result.statusCode).toBe(202);
    expect(deps.verifyTurnstile).toHaveBeenCalledWith({
      secret: "secret",
      token: "valid-token",
      remoteIp: "203.0.113.10",
    });
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith("request-123", "CONTACT_SENT");
  });

  test.each([
    ["name", ""],
    ["email", "not-an-email"],
    ["phone", "123"],
    ["serviceInterest", "unknown"],
    ["budget", "unknown"],
    ["description", "short"],
    ["sourceSolution", "unknown"],
    ["turnstileToken", ""],
    ["formStartedAt", "not-a-number"],
  ])("rejects an invalid %s field", async (field, value) => {
    const deps = dependencies();
    const body = { ...validBody(), [field]: value };
    const result = await createHandler(deps)(event(body));

    expect(result.statusCode).toBe(400);
    expect(deps.verifyTurnstile).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  test("rejects malformed JSON", async () => {
    const deps = dependencies();
    const result = await createHandler(deps)(event("{"));

    expect(result.statusCode).toBe(400);
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  test("rejects an oversized body", async () => {
    const deps = dependencies();
    const result = await createHandler(deps)(
      event(JSON.stringify({ ...validBody(), padding: "x".repeat(33 * 1024) })),
    );

    expect(result.statusCode).toBe(400);
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  test("silently accepts a filled honeypot without verification or email", async () => {
    const deps = dependencies();
    const result = await createHandler(deps)(
      event({ ...validBody(), website: "https://spam.example" }),
    );

    expect(result.statusCode).toBe(202);
    expect(deps.verifyTurnstile).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith("request-123", "BOT_SIGNAL_ACCEPTED");
  });

  test("silently accepts an implausibly fast submission without sending", async () => {
    const deps = dependencies();
    const result = await createHandler(deps)(
      event({ ...validBody(), formStartedAt: now - 1_000 }),
    );

    expect(result.statusCode).toBe(202);
    expect(deps.verifyTurnstile).not.toHaveBeenCalled();
    expect(deps.sendEmail).not.toHaveBeenCalled();
  });

  test.each([
    [{ success: false }, "failed challenge"],
    [
      { success: true, hostname: "attacker.example", action: "contact" },
      "wrong hostname",
    ],
    [
      {
        success: true,
        hostname: "www.mcadamsdevelopment.com",
        action: "other",
      },
      "wrong action",
    ],
    [
      { success: false, "error-codes": ["timeout-or-duplicate"] },
      "expired or duplicate token",
    ],
  ])("rejects Turnstile verification for %s", async (verification, _description) => {
    const deps = dependencies();
    deps.verifyTurnstile.mockResolvedValue(verification);

    const result = await createHandler(deps)(event());

    expect(result.statusCode).toBe(422);
    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith("request-123", "TURNSTILE_REJECTED");
  });

  test("returns a retryable provider error when Turnstile times out", async () => {
    const deps = dependencies();
    deps.verifyTurnstile.mockRejectedValue(new Error("timeout"));

    const result = await createHandler(deps)(event());

    expect(result.statusCode).toBe(502);
    expect(deps.sendEmail).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith("request-123", "PROVIDER_FAILED");
  });

  test("returns a retryable provider error when SES fails", async () => {
    const deps = dependencies();
    deps.sendEmail.mockRejectedValue(new Error("SES unavailable"));

    const result = await createHandler(deps)(event());

    expect(result.statusCode).toBe(502);
    expect(deps.sendEmail).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith("request-123", "PROVIDER_FAILED");
  });

  test("handles CORS preflight without invoking providers", async () => {
    const deps = dependencies();
    const preflight = event();
    preflight.httpMethod = "OPTIONS";

    const result = await createHandler(deps)(preflight);

    expect(result.statusCode).toBe(204);
    expect(result.headers?.["Access-Control-Allow-Origin"]).toBe(
      "https://www.mcadamsdevelopment.com",
    );
    expect(deps.verifyTurnstile).not.toHaveBeenCalled();
  });
});
