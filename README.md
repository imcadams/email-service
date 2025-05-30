# AWS Lambda Email Service

A TypeScript-based AWS Lambda function for sending emails using Amazon SES (Simple Email Service).

## Prerequisites

- AWS Account
- Node.js 18.x or later
- AWS CLI configured with appropriate credentials
- Verified email addresses in Amazon SES (required for sending emails)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Build the project:
   ```bash
   npm run build
   ```

3. Configure AWS SES:
   - Verify your email addresses in SES console
   - If in sandbox mode, verify both sender and recipient emails
   - Update the region in `src/index.ts` if needed

## Deployment

1. Create a ZIP file of the `dist` folder and dependencies
2. Create a new Lambda function in AWS Console
   - Runtime: Node.js 18.x
   - Handler: index.handler
3. Upload the ZIP file
4. Configure environment variables if needed
5. Set up an API Gateway trigger if you want to invoke via HTTP

## Usage

Send a POST request to your Lambda function with the following JSON body:

```json
{
  "to": ["recipient@example.com"],
  "subject": "Test Email",
  "body": "Hello from Lambda!",
  "from": "sender@example.com"
}
```

## IAM Permissions

Ensure your Lambda function has the following IAM permissions:
- `ses:SendEmail`
- `ses:SendRawEmail`