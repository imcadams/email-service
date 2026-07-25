import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { EmailServiceStack } from '../lib/cdk_infra-stack';

function template(): Template {
  const app = new cdk.App();
  const stack = new EmailServiceStack(app, 'EmailServiceStack', {
    env: {
      account: '957356740227',
      region: 'us-east-1',
    },
    githubOrg: 'imcadams',
    githubRepo: 'email-service',
  });

  return Template.fromStack(stack);
}

describe('EmailServiceStack', () => {
  test('creates a public contact method without an API key', () => {
    const synthesized = template();

    synthesized.hasResourceProperties('AWS::ApiGateway::Resource', {
      PathPart: 'contact',
    });
    synthesized.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'POST',
      ApiKeyRequired: false,
      AuthorizationType: 'NONE',
    });
  });

  test('configures contact-specific stage throttling', () => {
    template().hasResourceProperties('AWS::ApiGateway::Stage', {
      MethodSettings: Match.arrayWith([
        Match.objectLike({
          HttpMethod: 'POST',
          ResourcePath: '/~1contact',
          ThrottlingRateLimit: 2,
          ThrottlingBurstLimit: 5,
        }),
      ]),
    });
  });

  test('uses Node 22 and backend-only Turnstile configuration', () => {
    template().hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Timeout: 10,
      Environment: {
        Variables: Match.objectLike({
          TURNSTILE_SECRET_ID: 'mcadams-development/turnstile-secret-key',
          TURNSTILE_ALLOWED_HOSTNAME: 'www.mcadamsdevelopment.com',
          FIXED_FROM_ADDRESS: 'info@mcadamsdevelopment.com',
          FIXED_TO_ADDRESS: 'info@mcadamsdevelopment.com',
        }),
      },
    });
  });

  test('limits Lambda permissions to the contact secret and SES identity', () => {
    const synthesized = template();

    synthesized.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'ses:SendEmail',
            Effect: 'Allow',
            Resource:
              'arn:aws:ses:us-east-1:957356740227:identity/info@mcadamsdevelopment.com',
          }),
          Match.objectLike({
            Action: Match.arrayWith([
              'secretsmanager:GetSecretValue',
              'secretsmanager:DescribeSecret',
            ]),
            Effect: 'Allow',
            Resource: Match.objectLike({
              'Fn::Join': Match.anyValue(),
            }),
          }),
        ]),
      },
    });
    expect(JSON.stringify(synthesized.toJSON())).toContain(
      'mcadams-development/turnstile-secret-key',
    );
  });

  test('restricts GitHub OIDC trust to the master branch', () => {
    template().hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'EmailService-GitHubActionsDeployRole-EmailServiceStack',
      AssumeRolePolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: Match.objectLike({
              StringLike: {
                'token.actions.githubusercontent.com:sub':
                  'repo:imcadams/email-service:ref:refs/heads/master',
              },
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
              },
            }),
          }),
        ]),
      },
    });
  });
});
