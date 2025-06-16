import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
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
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: [
        // Restrict to the specific verified identity
        `arn:aws:ses:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:identity/info@mcadamsdevelopment.com`
      ], 
    }));

    // 2. AWS Lambda Function
    const emailLambda = new lambda.Function(this, 'EmailLambdaFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      code: lambda.Code.fromAsset(path.join(__dirname, '..', '..', 'dist')), // Corrected path to point to root dist folder
      handler: 'index.handler',
      role: lambdaExecutionRole,
      architecture: lambda.Architecture.X86_64,
      environment: {
        SES_AWS_REGION: cdk.Stack.of(this).region, // Set SES region from stack region
        FIXED_FROM_ADDRESS: 'info@mcadamsdevelopment.com',
      },
      timeout: cdk.Duration.seconds(30), // Optional: default is 3 seconds
      memorySize: 128, // Optional: default is 128 MB
    });

    // 3. API Gateway
    const api = new apigateway.RestApi(this, 'EmailServiceApi', {
      restApiName: 'Email Service API',
      description: 'API Gateway for Email Service',
      deployOptions: {
        stageName: 'prod', // Default stage
      },
      defaultCorsPreflightOptions: {
        allowOrigins: ['https://www.mcadamsdevelopment.com', 'https://mcadamsdevelopment.com'],
        allowMethods: ['POST'],
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token'],
      },
    });

    const emailResource = api.root.addResource('email');
    const emailIntegration = new apigateway.LambdaIntegration(emailLambda);
    emailResource.addMethod('POST', emailIntegration, {
      apiKeyRequired: true,
    });

    // 4. API Key and Usage Plan
    const apiKey = new apigateway.ApiKey(this, 'EmailServiceApiKey', {
      apiKeyName: 'email-service-key',
      description: 'API Key for Email Service',
      enabled: true,
    });

    const usagePlan = new apigateway.UsagePlan(this, 'EmailServiceUsagePlan', {
      name: 'EmailServiceUsagePlan',
      description: 'Usage plan for Email Service',
      apiStages: [
        {
          api: api,
          stage: api.deploymentStage,
        },
      ],
      throttle: {
        rateLimit: 10, // requests per second
        burstLimit: 2 // burst requests
      },
      quota: {
        limit: 1000, // requests per month
        period: apigateway.Period.MONTH
      }
    });

    usagePlan.addApiKey(apiKey);

    // 5. IAM Role for GitHub Actions to deploy this stack
    const githubActionsRole = new iam.Role(this, 'GitHubActionsDeployRole', {
      assumedBy: new iam.FederatedPrincipal(
        `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
        {
          StringLike: {
            'token.actions.githubusercontent.com:sub': `repo:${props.githubOrg}/${props.githubRepo}:*`,
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
                "iam:TagRole"
              ],
              resources: [
                // Role name pattern for the Lambda execution role created by this stack
                `arn:aws:iam::${this.account}:role/${this.stackName}-${lambdaExecutionRole.node.id}-*`
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
                `arn:aws:apigateway:${this.region}::/apikeys`,
                `arn:aws:apigateway:${this.region}::/apikeys/${apiKey.keyId}`,
                // `arn:aws:apigateway:${this.region}::/apikeys/${apiKey.keyId}/*`, // Usually not needed for API key itself
                `arn:aws:apigateway:${this.region}::/usageplans`,
                `arn:aws:apigateway:${this.region}::/usageplans/${usagePlan.usagePlanId}`,
                `arn:aws:apigateway:${this.region}::/usageplans/${usagePlan.usagePlanId}/*` // For linking keys to usage plan
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
    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: api.urlForPath(emailResource.path),
      description: 'API Gateway endpoint URL for Email service',
    });

    new cdk.CfnOutput(this, 'ApiKeyId', {
      value: apiKey.keyId,
      description: 'API Key ID for Email service (use this to retrieve the key value from AWS console or Secrets Manager if configured)',
    });

    new cdk.CfnOutput(this, 'GitHubActionsRoleArn', {
      value: githubActionsRole.roleArn,
      description: 'ARN of the IAM Role for GitHub Actions to deploy this stack',
    });
  }
}