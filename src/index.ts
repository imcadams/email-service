import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";

const sesClient = new SESClient({ region: "us-east-1" }); // Change this to your AWS region

interface EmailRequest {
  to: string[];
  subject: string;
  body: string;
  from: string;
}

function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function validateEmailRequest(request: EmailRequest): string | null {
  if (!request.to || !Array.isArray(request.to) || request.to.length === 0) {
    return "Recipients list is required and must not be empty";
  }

  if (!request.from || typeof request.from !== 'string') {
    return "From address is required and must be a string";
  }

  if (!request.subject || typeof request.subject !== 'string') {
    return "Subject is required and must be a string";
  }

  if (!request.body || typeof request.body !== 'string') {
    return "Body is required and must be a string";
  }

  if (!isValidEmail(request.from)) {
    return "Invalid sender email address";
  }

  for (const recipient of request.to) {
    if (!isValidEmail(recipient)) {
      return `Invalid recipient email address: ${recipient}`;
    }
  }

  return null;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
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
      Source: emailRequest.from,
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