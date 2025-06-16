### CDK Migration Checklist

- [x] **1. Confirm Application Functionality and Architecture (Update README - Part 1)**
    - [x] Document the current application.
        - Purpose: The application is an email service that allows sending emails via an HTTP API endpoint.
        - Core Components & Flow:
            - A React frontend (or any HTTP client) will call an API Gateway endpoint.
            - API Gateway will trigger an AWS Lambda function.
            - The Lambda function (written in TypeScript, running on Node.js 18.x, x86_64) will use AWS SES (Simple Email Service) to send the email.
            - Authentication: API Gateway will use an API Key for authenticating requests.
            - CI/CD: GitHub Actions will be used to build the Lambda code, and deploy the infrastructure using AWS CDK.
        - Current Pain Points with CloudFormation: (As observed) Difficulty in managing dependencies between resources, error handling during deployments, and complex conditional logic for different states (e.g., `ROLLBACK_COMPLETE`).
    - [x] File to Update: `README.md`.

- [x] **2. Set Up AWS CDK Project**
    - [x] Install AWS CDK CLI globally if not already installed (`npm install -g aws-cdk`).
    - [x] Initialize a new CDK project within the `email-service` directory (`cdk init app --language typescript`).

- [x] **3. Define Infrastructure as Code using CDK**
    - [x] Create a new CDK stack (e.g., `EmailServiceStack` in the `lib` directory).
    - [x] Define the following resources in the CDK stack:
        - [x] AWS Lambda Function (using Node.js 20.x, from `src/index.ts` code, x86_64 architecture).
        - [x] IAM Role for Lambda Execution with policies for SES (send email) and CloudWatch Logs.
        - [x] API Gateway (RestApi).
            - [x] Resource (e.g., `/email`).
            - [x] Method (POST) with Lambda integration.
            - [x] API Key and Usage Plan.
            - [x] Deployment and Stage.
            - [x] CORS configuration.
        - [x] IAM Role for GitHub Actions (OIDC provider for `token.actions.githubusercontent.com`).
            - [x] Trust policy allowing your GitHub repository to assume this role.
            - [x] Permissions to deploy CDK stacks (CloudFormation, S3 for CDK assets, IAM passrole, etc.) and update the Lambda function code.
    - [x] Synthesize CDK stack (`cdk synth`) to verify basic stack structure.
    - [x] Verify Lambda code (`src/index.ts`) compatibility with Node.js 20.x runtime.
        - Note: Manually verified "info@mcadamsdevelopment.com" in SES (us-east-1) for sending.
    - [x] Review and restrict permissions for `GitHubActionsDeployRole` (scope down from `*`).
    - [x] Verify Lambda code (`src/index.ts`) compatibility with Node.js 20.x runtime.

- [x] **4. Update CI/CD Workflow (`.github/workflows/main.yml`)**
    - [x] Create a new workflow file for CDK deployment (e.g., `.github/workflows/main.yml`).
    - [x] Define `build_and_test` job:
        - [x] Checkout code.
        - [x] Set up Node.js.
        - [x] Install root and CDK dependencies.
        - [x] Build Lambda function.
        - [x] Run CDK tests.
        - [x] Synthesize CDK stack.
    - [x] Define `deploy_prod` job (triggered on push to `main`):
        - [x] Checkout code, set up Node.js, install dependencies, build Lambda.
        - [x] Configure AWS credentials using OIDC and the `GitHubActionsDeployRole`.
        - [x] Deploy CDK stack (`cdk deploy EmailServiceStack --require-approval never`).
        - [x] Use GitHub Actions variables for AWS Account ID and Region.
    - [x] Adjust how outputs (API endpoint, Lambda function name, API Key Secret ARN) are retrieved and passed if needed for other processes. *(Currently, outputs are saved to `cdk-outputs.json` but not actively used by subsequent steps in this workflow)*.

- [x] **5. Clean Up Old CloudFormation Files**
    - [x] Delete `aws/template.yml`.
    - [x] Delete `aws/bootstrap-role-permissions-policy.json`.
    - [x] Delete `aws/github-actions-role-policy.json`.
    - [x] Delete `aws/lambda-execution-role-policy.json`.
    - [x] Delete `aws/bootstrap-role-trust-policy.json`.
    - [x] Evaluate `aws/dev-user-policy.json` for continued relevance. *(Kept as per user request)*

- [x] **6. Update `README.md` (Part 2)**
    - [x] Reflect new CDK-based infrastructure management.
    - [x] Add new prerequisites (CDK CLI).
    - [x] Update setup instructions.
    - [x] Update build instructions.
    - [x] Update deployment instructions (e.g., `cdk deploy`).
    - [x] Document the new architecture as defined by CDK.
    - [x] Explain how to get the API Key.

- [ ] **7. Testing**
    - [x] Manually deploy the CDK stack from local environment (`cdk deploy`).
    - [x] Test email sending functionality via API Gateway.
    - [ ] Trigger GitHub Actions workflow and verify successful deployment.
    - [ ] Verify API Key retrieval for frontend use.

- [ ] **8. Future Enhancements & Considerations**
    - [ ] **Add a Development/Staging Environment:**
        - Create a `develop` branch in GitHub.
        - Duplicate the `deploy_prod` job in `.github/workflows/main.yml` to a `deploy_dev` job.
        - Trigger `deploy_dev` on pushes to the `develop` branch.
        - Parameterize the `EmailServiceStack` or create a separate stack instance (e.g., `DevEmailServiceStack`) to manage configurations and avoid resource name clashes. This would involve changes in `cdk_infra/bin/cdk_infra.ts` and potentially `cdk_infra/lib/cdk_infra-stack.ts`.
    - [ ] **Linting/Formatting:** Add steps for ESLint and Prettier in the CI/CD workflow.
    - [ ] **Lambda Unit Tests:** Add a separate testing step in the CI/CD workflow for unit tests specifically for the `src/index.ts` Lambda code (e.g., using Jest).
    - [ ] **Security Scanning:** Incorporate tools like `npm audit` or other vulnerability scanners into the CI/CD workflow.
    - [ ] **Artifact Management:** For more complex workflows, consider passing build artifacts (like the `dist` folder or `node_modules`) between jobs instead of rebuilding/reinstalling in each job.
    - [ ] **AWS Secrets Manager for API Key:** Implement storing and retrieving the API Gateway API Key value using AWS Secrets Manager for better security and management, instead of just outputting the Key ID.
    - [ ] **4. SES Configuration (Domain/Email Identity Verification):** Ensure domain and/or email identities are verified in SES for the FROM_ADDRESS.
    - [ ] **5. CloudWatch Alarms:** Set up CloudWatch Alarms for Lambda function errors, high invocation rates, and API Gateway 5XX errors.
    - [ ] **AWS WAF for API Gateway:** Integrate AWS WAF with API Gateway for enhanced security against common web exploits.

- [ ] **9. Refine Lambda CORS `responseOrigin` Logic in `src/index.ts`**
    - [ ] Ensure `responseOrigin` is always a string to satisfy TypeScript types for `APIGatewayProxyResult` headers.
    - [ ] Implement fallback logic: `defaultOriginEnv` (from `CORS_ALLOWED_ORIGIN_SINGLE`) -> first origin in `allowedOriginsEnv` (from `ALLOWED_ORIGINS`) -> `'*'` as a final fallback.
