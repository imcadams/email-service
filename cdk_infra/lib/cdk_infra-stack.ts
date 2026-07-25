import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as path from 'path';

export interface EmailServiceStackProps extends cdk.StackProps {
  githubOrg: string;
  githubRepo: string;
  // stageName: string; // If you want to make the stage (e.g., prod, dev) configurable
}

export class EmailServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EmailServiceStackProps) {
    super(scope, id, props);

    // 1. IAM Role for Lambda Execution
    const lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
    });

    // Add SES send permissions to the Lambda role
    lambdaExecutionRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail'],
      resources: [
        `arn:aws:ses:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:identity/info@mcadamsdevelopment.com`
      ],
    }));

    const turnstileSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'TurnstileSecret',
      'mcadams-development/turnstile-secret-key',
    );
    turnstileSecret.grantRead(lambdaExecutionRole);

    // 2. AWS Lambda Function
    const emailLambda = new lambda.Function(this, 'EmailLambdaFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      code: lambda.Code.fromAsset(path.join(__dirname, '..', '..', 'dist')),
      handler: 'index.handler',
      role: lambdaExecutionRole,
      architecture: lambda.Architecture.X86_64,
      environment: {
        SES_AWS_REGION: cdk.Stack.of(this).region,
        FIXED_FROM_ADDRESS: 'info@mcadamsdevelopment.com',
        FIXED_TO_ADDRESS: 'info@mcadamsdevelopment.com',
        TURNSTILE_SECRET_ID: turnstileSecret.secretName,
        TURNSTILE_ALLOWED_HOSTNAME: 'www.mcadamsdevelopment.com',
      },
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
    });

    // 3. API Gateway
    const api = new apigateway.RestApi(this, 'EmailServiceApi', {
      restApiName: 'Email Service API',
      description: 'API Gateway for Email Service',
      deployOptions: {
        stageName: 'prod',
        methodOptions: {
          '/contact/POST': {
            throttlingRateLimit: 2,
            throttlingBurstLimit: 5,
          },
        },
      },
      defaultCorsPreflightOptions: {
        allowOrigins: ['https://www.mcadamsdevelopment.com', 'https://mcadamsdevelopment.com'],
        allowMethods: ['POST'],
        allowHeaders: ['Content-Type'],
      },
    });

    const emailIntegration = new apigateway.LambdaIntegration(emailLambda);

    const contactResource = api.root.addResource('contact');
    contactResource.addMethod('POST', emailIntegration, {
      apiKeyRequired: false,
    });

    // 4. IAM Role for GitHub Actions to deploy this stack
    const githubActionsRole = new iam.Role(this, 'GitHubActionsDeployRole', {
      assumedBy: new iam.FederatedPrincipal(
        `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
        {
          StringLike: {
            'token.actions.githubusercontent.com:sub': `repo:${props.githubOrg}/${props.githubRepo}:ref:refs/heads/master`,
          },
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
      roleName: `EmailService-GitHubActionsDeployRole-${this.stackName}`,
      description: 'Role assumed by GitHub Actions to deploy the EmailService stack',
      maxSessionDuration: cdk.Duration.hours(1),
      // Define refined inline policies instead of a broad addToPolicy
      inlinePolicies: {
        'GitHubActionsDeployPolicy': new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              actions: [
                "cloudformation:DescribeStacks", "cloudformation:DescribeStackEvents",
                "cloudformation:DescribeStackResources", "cloudformation:GetTemplate", "cloudformation:GetTemplateSummary",
                "cloudformation:ListStackResources", "cloudformation:CreateStack",
                "cloudformation:UpdateStack", "cloudformation:DeleteStack",
                "cloudformation:CreateChangeSet", "cloudformation:DescribeChangeSet",
                "cloudformation:ExecuteChangeSet", "cloudformation:DeleteChangeSet",
                "cloudformation:ValidateTemplate"
              ],
              resources: [
                `arn:aws:cloudformation:${this.region}:${this.account}:stack/${this.stackName}/*`,
                `arn:aws:cloudformation:${this.region}:${this.account}:stack/CDKToolkit/*`
              ],
            }),
            new iam.PolicyStatement({
              actions: ["s3:GetObject*", "s3:PutObject*", "s3:DeleteObject*", "s3:ListBucket", "s3:GetBucketLocation"],
              resources: [
                `arn:aws:s3:::cdk-hnb659fds-assets-${this.account}-${this.region}`,
                `arn:aws:s3:::cdk-hnb659fds-assets-${this.account}-${this.region}/*`
              ],
            }),
            new iam.PolicyStatement({
              actions: [
                "iam:GetRole", "iam:CreateRole", "iam:DeleteRole",
                "iam:AttachRolePolicy", "iam:PutRolePolicy", "iam:DetachRolePolicy", "iam:DeleteRolePolicy",
                "iam:TagRole", "iam:UpdateAssumeRolePolicy"
              ],
              resources: [
                `arn:aws:iam::${this.account}:role/${this.stackName}-${lambdaExecutionRole.node.id}-*`,
                `arn:aws:iam::${this.account}:role/EmailService-GitHubActionsDeployRole-${this.stackName}`
              ],
            }),
            new iam.PolicyStatement({
              actions: ["iam:PassRole"],
              resources: [
                // Specific ARN pattern for the Lambda execution role
                `arn:aws:iam::${this.account}:role/${this.stackName}-${lambdaExecutionRole.node.id}-*`
              ],
              conditions: {
                 StringEquals: { "iam:PassedToService": "lambda.amazonaws.com" }
              }
            }),
            new iam.PolicyStatement({
              actions: [
                "lambda:GetFunction", "lambda:CreateFunction", "lambda:DeleteFunction",
                "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration",
                "lambda:TagResource", "lambda:UntagResource",
                "lambda:AddPermission", "lambda:RemovePermission", "lambda:GetPolicy", "lambda:ListVersionsByFunction",
                "lambda:GetFunctionConfiguration"
              ],
              resources: [emailLambda.functionArn],
            }),
            new iam.PolicyStatement({
              actions: ["logs:CreateLogGroup", "logs:PutRetentionPolicy", "logs:DeleteLogGroup", "logs:DescribeLogGroups"],
              resources: [emailLambda.logGroup.logGroupArn],
            }),
            new iam.PolicyStatement({
              actions: [
                "apigateway:GET", "apigateway:POST", "apigateway:PUT", "apigateway:DELETE", "apigateway:PATCH"
              ],
              resources: [
                `arn:aws:apigateway:${this.region}::/restapis`,
                `arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}`,
                `arn:aws:apigateway:${this.region}::/restapis/${api.restApiId}/*`,
              ],
            }),
            // This is intentionally delete-only: it permits this update to
            // remove the two previously deployed legacy resources, but cannot
            // create, read, or re-enable an API key or usage plan.
            new iam.PolicyStatement({
              actions: ["apigateway:DELETE"],
              resources: [
                `arn:aws:apigateway:${this.region}::/apikeys/l95oirtw4g`,
                `arn:aws:apigateway:${this.region}::/usageplans/hq6i24`,
                `arn:aws:apigateway:${this.region}::/usageplans/hq6i24/*`,
              ],
            }),
            new iam.PolicyStatement({
              actions: ["ssm:GetParameter"],
              resources: [
                `arn:aws:ssm:${this.region}:${this.account}:parameter/cdk-bootstrap/hnb659fds/version`
              ],
            }),
            new iam.PolicyStatement({
              actions: ["sts:AssumeRole"],
              resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*`],
            }),
          ],
        }),
      },
    });

    // Outputs
    new cdk.CfnOutput(this, 'ContactApiEndpoint', {
      value: api.urlForPath(contactResource.path),
      description: 'Public contact endpoint protected by server-side Turnstile verification',
    });

    new cdk.CfnOutput(this, 'GitHubActionsRoleArn', {
      value: githubActionsRole.roleArn,
      description: 'ARN of the IAM Role for GitHub Actions to deploy this stack',
    });
  }
}
