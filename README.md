# McAdams Contact Service — System Design

## Current state

This repository is the source of truth for the production contact backend for
`www.mcadamsdevelopment.com`. It is deployed as the `EmailServiceStack` CDK
stack in `us-east-1`.

- Public API: `POST /contact` on API Gateway.
- Compute: one Node.js 22 Lambda function.
- Delivery: Amazon SES sends a plain-text message only to
  `info@mcadamsdevelopment.com`.
- Bot control: Cloudflare Turnstile is verified server-side before SES is
  called.
- Secret storage: the Turnstile secret is in AWS Secrets Manager under
  `mcadams-development/turnstile-secret-key`; its value is never committed or
  stored in GitHub.
- Legacy state: the browser API key, `/email` route, API key, and usage plan
  have been removed. They cannot be recreated by the current CDK stack.

The website redirects the apex hostname to `www` at CloudFront before the
contact page loads. Turnstile verification therefore requires the canonical
hostname `www.mcadamsdevelopment.com` and action `contact`.

## Request flow

```text
Browser contact form
  -> Turnstile browser token + public fields
  -> API Gateway POST /contact (2 requests/sec, burst 5)
  -> Lambda validates body, honeypot, and form age
  -> Lambda reads/caches Turnstile secret for five minutes
  -> Cloudflare Siteverify (3-second timeout; hostname + action checked)
  -> Amazon SES SendEmail to the fixed recipient
```

The browser sends no API key and cannot select a recipient, sender, or subject.
The visitor email is used only as the SES reply-to address. The Lambda accepts
at most 32 KiB and validates bounded fields and known service, budget, and
solution values.

Filled honeypots and submissions completed in under three seconds receive a
neutral `202` response without sending email. Other responses are `400` for
malformed input, `422` for a rejected Turnstile challenge, `429` when throttled,
and a generic `5xx` for a provider failure. CORS responses are supplied for the
production site origins.

## Privacy and operations

CloudWatch logs contain request IDs and outcome codes only, such as
`CONTACT_SENT`, `TURNSTILE_REJECTED`, and `VALIDATION_REJECTED`. They never log
form content, contact details, Turnstile tokens, or secret values.

Monitor Lambda errors, API Gateway 4xx/5xx and throttles, SES sends, and the
Turnstile outcome codes. Rotate Turnstile by updating the Secrets Manager value;
no GitHub secret or frontend change is needed.

## Development and deployment

```bash
npm ci
npm run build
npm test

cd cdk_infra
npm ci
npm run build
npm test
npx cdk synth EmailServiceStack
```

GitHub Actions runs the build and tests for pull requests. Pushes to `master`
deploy through GitHub OIDC using
`EmailService-GitHubActionsDeployRole-EmailServiceStack`. Its trust policy is
restricted to `repo:imcadams/email-service:ref:refs/heads/master`; no stored
AWS access keys or GitHub deployment secrets are used.
