# McAdams Contact Service

The service exposes a public `POST /contact` endpoint for
`mcadamsdevelopment.com`. It sends a fixed-recipient email through Amazon SES
only after server-side Cloudflare Turnstile verification.

## Security model

- The browser sends no API key and cannot choose email recipients or subjects.
- The Lambda reads the Turnstile secret from AWS Secrets Manager at runtime:
  `mcadams-development/turnstile-secret-key`.
- The public Turnstile site key belongs in the static website build; it is safe
  to commit. The Turnstile secret must never be committed or added to GitHub.
- Lambda permissions are limited to the Turnstile secret and SES sending from
  `info@mcadamsdevelopment.com`.
- The endpoint accepts only the two production site origins and applies API
  Gateway throttling to `POST /contact`.

## Contact API

Send JSON to the API Gateway base URL plus `/contact`:

```json
{
  "name": "Jane Customer",
  "email": "jane@example.com",
  "phone": "470-555-0100",
  "serviceInterest": "ai-receptionist",
  "budget": "5k-15k",
  "description": "I would like to discuss an AI receptionist.",
  "sourceSolution": "hvac-ai-receptionist",
  "turnstileToken": "token-from-widget",
  "website": "",
  "formStartedAt": 1800000000000
}
```

The server validates the payload, ignores honeypot and implausibly fast bot
submissions without sending email, verifies the token for action `contact` and
hostname `www.mcadamsdevelopment.com`, and returns `202` only after SES accepts
the message. It never logs submitted contact details, message content, tokens,
or secret values.

## Development and deployment

```bash
npm ci
npm run build
npm test

cd cdk_infra
npm ci
npm test
npx cdk synth EmailServiceStack
```

GitHub Actions deploys pushes to `master` with OIDC using the scoped
`EmailService-GitHubActionsDeployRole-EmailServiceStack` role. No GitHub
credentials or deployment variables are required.

The legacy `/email` endpoint and its API key are retained only for the additive
rollout. Remove both from CDK after the production `/contact` smoke test passes.
