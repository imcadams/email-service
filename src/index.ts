import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

// Use the AWS_REGION environment variable provided by the Lambda runtime by default,
// or a specific one if set (e.g., SES_AWS_REGION for SES if it needs to be different).
const sesAwsRegion = process.env.SES_AWS_REGION || process.env.AWS_REGION || "us-east-1";
const sesClient = new SESClient({ region: sesAwsRegion });

// Read the fixed FROM address from environment variable
const fixedFromAddress = process.env.FIXED_FROM_ADDRESS;

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
  try {
    if (!fixedFromAddress) {
      console.error("Configuration error: FIXED_FROM_ADDRESS environment variable is not set.");
      return {
        statusCode: 500,
        body: JSON.stringify({ message: "Internal server configuration error: Missing sender address." })
      };
    }

    if (!event.body) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Request body is required" })
      };
    }

    const emailRequest: EmailRequest = JSON.parse(event.body);
    const validationError = validateEmailRequest(emailRequest);
    
    if (validationError) {
      return {
        statusCode: 400,
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
        'Content-Type': 'application/json'
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
        body: JSON.stringify({ 
          message: "Invalid JSON in request body"
        })
      };
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ 
        message: "Error sending email", 
        error: error instanceof Error ? error.message : 'Unknown error'
      })
    };
  }
};