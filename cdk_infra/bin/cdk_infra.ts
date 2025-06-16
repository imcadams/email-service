#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { EmailServiceStack, EmailServiceStackProps } from '../lib/cdk_infra-stack';

const app = new cdk.App();

// Retrieve GitHub org and repo from environment variables or context
// For local deployment, you might set these as context in cdk.json or pass via CLI
// For CI/CD, these should be available as environment variables
const githubOrg = app.node.tryGetContext('githubOrg') || process.env.GITHUB_REPOSITORY_OWNER || 'imcadams'; // Default or from env
const githubRepo = app.node.tryGetContext('githubRepo') || process.env.GITHUB_REPOSITORY_NAME || 'email-service'; // Default or from env

if (!githubOrg || !githubRepo) {
  throw new Error('GitHub organization (githubOrg) and repository name (githubRepo) must be provided either via CDK context or GITHUB_REPOSITORY_OWNER/GITHUB_REPOSITORY_NAME environment variables.');
}

const stackProps: EmailServiceStackProps = {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  githubOrg: githubOrg,
  githubRepo: githubRepo,
  // stageName: 'prod', // If you make stage configurable
};

new EmailServiceStack(app, 'EmailServiceStack', stackProps);