# AWS Lambda Email Service (Managed by CDK)

A TypeScript-based AWS Lambda function for sending emails using Amazon SES (Simple Email Service), with infrastructure managed by the AWS Cloud Development Kit (CDK).

## Overview

This service provides an HTTP API endpoint to send emails. It is designed to be called by a frontend application (e.g., a React app) or any other HTTP client.

### Architecture

1.  **Client Application**: Makes an HTTP POST request to the API Gateway endpoint.
2.  **API Gateway**: 
    *   Authenticates the request using an API Key.
    *   Triggers the AWS Lambda function.
3.  **AWS Lambda**: 
    *   Written in TypeScript, runs on Node.js 20.x (x86_64 architecture).
    *   Parses the request and uses the AWS SES SDK to send the email.
4.  **AWS SES (Simple Email Service)**: Handles the actual email delivery.
5.  **Infrastructure as Code**: AWS CDK (TypeScript) is used to define and deploy all AWS resources.
6.  **CI/CD**: GitHub Actions automates the building of the Lambda function and the deployment of the CDK application.

### Why AWS CDK?

This project uses AWS CDK for managing cloud infrastructure, moving from a previous CloudFormation-based approach. CDK offers several advantages:

*   **Familiar Programming Languages**: Define infrastructure using TypeScript, enabling better code organization, reusability, and testing.
*   **Higher-Level Abstractions**: Simplifies the definition of complex cloud resources and their interdependencies.
*   **Improved Developer Experience**: Streamlines the development and deployment workflow.

## Prerequisites

*   AWS Account
*   Node.js 20.x or later (for local development and AWS CDK)
*   AWS CLI configured with appropriate credentials
*   AWS CDK CLI (`npm install -g aws-cdk`)
*   Verified email addresses or a verified domain in Amazon SES (required for sending emails, especially outside of the SES sandbox).

## Setup (CDK Based)

1.  **Clone the repository.**
2.  **Install root dependencies (for Lambda function code):**
    ```bash
    npm install
    ```
3.  **Build the Lambda function code (compiles TypeScript to JavaScript):**
    ```bash
    npm run build 
    ```
4.  **Navigate to the CDK project directory:** 
    ```bash
    cd cdk_infra
    ```
5.  **Install CDK application dependencies:**
    ```bash
    npm install 
    ```
6.  **Return to the root directory (optional, for subsequent commands if any are run from root):**
    ```bash
    cd ..
    ```
7.  **Configure AWS SES:**
    *   Ensure your sender and recipient email addresses are verified in the SES console, or that your domain is verified if sending from any address on that domain.
    *   If your SES account is in sandbox mode, both sender and recipient email addresses must be verified.
    *   The AWS region for SES and other resources will be configured within the CDK application.

## Deployment (CDK Based)

Deployment can be done manually from your local environment or automatically via the GitHub Actions CI/CD workflow.

### Manual Deployment (Local)

1.  **Navigate to the CDK project directory (if not already there):**
    ```bash
    cd cdk_infra
    ```
2.  **Bootstrap CDK (if you haven't for this AWS account/region before):**
    ```bash
    # Replace ACCOUNT-NUMBER and REGION with your AWS account ID and target region
    cdk bootstrap aws://ACCOUNT-NUMBER/REGION
    ```
3.  **Synthesize the CloudFormation template (optional, for review):**
    ```bash
    cdk synth
    ```
4.  **Deploy the CDK stack:**
    ```bash
    cdk deploy EmailServiceStack
    ```
    This command will provision all the necessary AWS resources. After a successful deployment, the API Gateway endpoint URL and the API Key ID will be displayed as outputs in your terminal.

### CI/CD Deployment (GitHub Actions)

The CI/CD workflow is configured in `.github/workflows/main.yml`.
*   On pushes or pull requests to the `main` branch, the workflow will build the Lambda, install CDK dependencies, run CDK tests, and synthesize the stack.
*   On a direct push to the `main` branch (e.g., after a pull request is merged), the workflow will also deploy the `EmailServiceStack` to the AWS account and region specified by the `AWS_ACCOUNT_ID` and `AWS_REGION` GitHub Actions variables.
*   Deployment outputs, including the API Gateway URL and API Key ID, are saved to `cdk_infra/cdk-outputs.json` within the GitHub Actions environment.

## Obtaining and Using the API Key

The CDK stack provisions an API Gateway API Key to secure the email endpoint.

1.  **API Key ID Output**:
    *   When deploying manually with `cdk deploy`, the `ApiKeyId` is shown in the terminal outputs.
    *   When deployed via GitHub Actions, the `ApiKeyId` can be found in the `cdk_infra/cdk-outputs.json` artifact or in the CloudFormation stack outputs in the AWS console.

2.  **Retrieving the API Key Value**:
    The `x-api-key` header requires the actual API Key *value*, not its ID. To retrieve the value:
    *   Go to the AWS API Gateway console.
    *   Navigate to "API Keys" in the region where you deployed the stack.
    *   Find the API Key using the `ApiKeyId` obtained from the deployment outputs.
    *   Click "Show" to reveal the API Key value.

    *Note: For enhanced security and easier management in a production environment, the future enhancement is to store this key value in AWS Secrets Manager (see `CDK_MIGRATION_CHECKLIST.md`).*

## Usage

Send a POST request to the API Gateway endpoint (the `ApiGatewayUrl` from the deployment outputs). Include an `x-api-key` header with the API Key *value* you retrieved from the AWS console.

**Request Body:**
```json
{
  "to": ["recipient@example.com"],
  "subject": "Test Email from CDK-managed Service",
  "body": "Hello from Lambda, deployed via CDK!",
  "from": "sender@example.com"
}
```

## IAM Permissions

The AWS CDK application will define and manage the necessary IAM roles and policies for:
*   **Lambda Execution Role**: Permissions to send emails via SES and write logs to CloudWatch.
*   **GitHub Actions Deployment Role**: Permissions to deploy CDK stacks (CloudFormation, S3 assets, IAM roles, API Gateway, Lambda, Secrets Manager, etc.).

Further details on specific permissions will be available within the CDK stack definition.

## Features

The Lambda function includes the following features and validations:

*   **Fixed "FROM" Address**: The email "FROM" address can be configured via the `FIXED_FROM_ADDRESS` environment variable set in the Lambda function's configuration. This ensures all emails are sent from a consistent, verified address.
*   **Recipient Limit**: A maximum of 10 recipients (`MAX_RECIPIENTS = 10`) are allowed per email request.
*   **Subject Length Limit**: The email subject has a maximum length of 256 characters (`MAX_SUBJECT_LENGTH = 256`).
*   **Body Length Limit**: The email body has a maximum length of 10,000 characters (`MAX_BODY_LENGTH = 10000`).