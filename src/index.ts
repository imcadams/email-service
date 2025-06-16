import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

// Use the AWS_REGION environment variable provided by the Lambda runtime by default,
// or a specific one if set (e.g., SES_AWS_REGION for SES if it needs to be different).
const sesAwsRegion = process.env.SES_AWS_REGION || process.env.AWS_REGION || "us-east-1";
const sesClient = new SESClient({ region: sesAwsRegion });

// Read the fixed FROM address from environment variable
const fixedFromAddress = process.env.FIXED_FROM_ADDRESS;

// Allowed origins from environment variables
const defaultOriginEnv = 'https://www.mcadamsdevelopment.com';
const allowedOriginsEnv = 'https://www.mcadamsdevelopment.com,https://mcadamsdevelopment.com'; // Comma-separated string

const getAllowedOrigins = (): string[] => {
  const origins: string[] = [];
  if (defaultOriginEnv) {
    origins.push(defaultOriginEnv.trim());
  }
  if (allowedOriginsEnv) {
    origins.push(...allowedOriginsEnv.split(',').map(o => o.trim()).filter(o => o));
  }
  return origins;
};

const getResponseOrigin = (requestOrigin: string | undefined, allowedOriginsFromEnv: string[]): string | undefined => {
  // If the request's origin is in the explicitly allowed list, use it.
  if (requestOrigin && allowedOriginsFromEnv.includes(requestOrigin)) {
    return requestOrigin;
  }
  // If there's a specific default origin configured (CORS_ALLOWED_ORIGIN_SINGLE),
  // and the requestOrigin was either not provided or didn't match the broader list,
  // use this default origin. This also covers the case where allowedOriginsFromEnv is empty.
  if (defaultOriginEnv) {
    return defaultOriginEnv.trim();
  }
  // If the requestOrigin is not in the allowed list and no specific default is set,
  // do not return an origin. This enforces a stricter policy.
  return undefined;
};


// Define common CORS headers - Access-Control-Allow-Origin will be set dynamically
const baseCorsHeaders = {
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};

const MAX_RECIPIENTS = 10;
const MAX_SUBJECT_LENGTH = 256;
const MAX_BODY_LENGTH = 10000;

interface EmailRequest {
  to: string[];
  subject: string;
  body: string;
  // from: string; // Removed as we will use a fixed from address
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validateEmailRequest(request: EmailRequest): string | null {
  if (!request.to || !Array.isArray(request.to) || request.to.length === 0) {
    return "Recipients list is required and must not be empty";
  }

  if (request.to.length > MAX_RECIPIENTS) {
    return `Number of recipients exceeds the maximum limit of ${MAX_RECIPIENTS}`;
  }

  // Removed from address validation as it's now fixed
  // if (!request.from || typeof request.from !== 'string') {
  //   return "From address is required and must be a string";
  // }

  if (!request.subject || typeof request.subject !== 'string') {
    return "Subject is required and must be a string";
  }

  if (request.subject.length > MAX_SUBJECT_LENGTH) {
    return `Subject length exceeds the maximum limit of ${MAX_SUBJECT_LENGTH} characters`;
  }

  if (!request.body || typeof request.body !== 'string') {
    return "Body is required and must be a string";
  }

  if (request.body.length > MAX_BODY_LENGTH) {
    return `Body length exceeds the maximum limit of ${MAX_BODY_LENGTH} characters`;
  }

  // Removed from address validation as it's now fixed
  // if (!isValidEmail(request.from)) {
  //   return "Invalid sender email address";
  // }

  for (const recipient of request.to) {
    if (!isValidEmail(recipient)) {
      return `Invalid recipient email address: ${recipient}`;
    }
  }

  return null;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const requestOrigin = event.headers.origin || event.headers.Origin; // Handle case-insensitivity for 'origin'
  const allowedOrigins = getAllowedOrigins();
  const responseOrigin = getResponseOrigin(requestOrigin, allowedOrigins);

  // Start with base headers that don't include Access-Control-Allow-Origin
  const corsHeaders: { [key: string]: string | boolean } = {
    ...baseCorsHeaders, // Spread base headers like Allow-Headers, Allow-Methods
  };

  // Dynamically set Access-Control-Allow-Origin only if a valid origin is determined
  if (responseOrigin) {
    corsHeaders['Access-Control-Allow-Origin'] = responseOrigin;
  }

  // Handle OPTIONS request for CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: corsHeaders,
      body: '',
    };
  }

  try {
    if (!fixedFromAddress) {
      console.error("Configuration error: FIXED_FROM_ADDRESS environment variable is not set.");
      return {
        statusCode: 500,
        headers: corsHeaders, // Add CORS headers
        body: JSON.stringify({ message: "Internal server configuration error: Missing sender address." })
      };
    }

    if (!event.body) {
      return {
        statusCode: 400,
        headers: corsHeaders, // Add CORS headers
        body: JSON.stringify({ message: "Request body is required" })
      };
    }

    const emailRequest: EmailRequest = JSON.parse(event.body);
    const validationError = validateEmailRequest(emailRequest);
    
    if (validationError) {
      return {
        statusCode: 400,
        headers: corsHeaders, // Add CORS headers
        body: JSON.stringify({ message: validationError })
      };
    }

    const params = {
      Destination: {
        ToAddresses: emailRequest.to,
      },
      Message: {
        Body: {
          Text: {
            Data: emailRequest.body,
          },
        },
        Subject: {
          Data: emailRequest.subject,
        },
      },
      Source: fixedFromAddress, // Use the fixed from address from env var
    };

    const command = new SendEmailCommand(params);
    await sesClient.send(command);

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders, // Spread CORS headers
        'Content-Type': 'application/json' // Keep existing content type or add others
      },
      body: JSON.stringify({ 
        message: "Email sent successfully",
        to: emailRequest.to,
        subject: emailRequest.subject
      })
    };
  } catch (error) {
    console.error("Error sending email:", error);
    
    if (error instanceof SyntaxError) {
      return {
        statusCode: 400,
        headers: corsHeaders, // Add CORS headers
        body: JSON.stringify({ 
          message: "Invalid JSON in request body"
        })
      };
    }

    return {
      statusCode: 500,
      headers: corsHeaders, // Add CORS headers
      body: JSON.stringify({ 
        message: "Error sending email", 
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};