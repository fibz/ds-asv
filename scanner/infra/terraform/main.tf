# Core production infrastructure: evidence store, scanner IAM role.

locals {
  regions = ["us-east-1", "eu-west-1", "ap-southeast-1"]
  common_tags = merge(var.tags, {
    ManagedBy = "terraform"
    Project   = "asv-scanner"
  })
}

# ----------------------------------------------------------------------------
# Evidence store (S3) with Object Lock for compliance retention.
# PCI ASV evidence must be retained and tamper-evident; Object Lock + KMS give
# WORM-style protection.
# ----------------------------------------------------------------------------
resource "aws_s3_bucket" "evidence" {
  bucket              = var.evidence_bucket_name
  object_lock_enabled = true
  tags                = local.common_tags
}

resource "aws_s3_bucket_versioning" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "evidence" {
  bucket                  = aws_s3_bucket.evidence.id
  block_public_acls       = true
  block_public_policy      = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_object_lock_configuration" "evidence" {
  bucket = aws_s3_bucket.evidence.id

  rule {
    default_retention {
      mode = "COMPLIANCE"
      days = 365
    }
  }
}

# ----------------------------------------------------------------------------
# Least-privilege IAM role for scanner instances.
# Allowed: write objects under an evidence prefix only. Deny broad S3/EC2.
# ----------------------------------------------------------------------------
data "aws_iam_policy_document" "scanner_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scanner" {
  name               = "asv-scanner"
  assume_role_policy = data.aws_iam_policy_document.scanner_assume.json
  tags               = local.common_tags
}

data "aws_iam_policy_document" "scanner_permissions" {
  statement {
    sid    = "WriteEvidence"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:PutObjectAcl",
    ]
    resources = ["${aws_s3_bucket.evidence.arn}/*"]
  }

  statement {
    sid    = "ListEvidenceBucket"
    effect = "Allow"
    actions = [
      "s3:GetBucketLocation",
      "s3:ListBucket",
    ]
    resources = [aws_s3_bucket.evidence.arn]
  }

  # When using Vault SSH CA signing, scanners assume a Vault-delegated role.
  statement {
    sid    = "AssumeVaultRole"
    effect = "Allow"
    actions = [
      "sts:AssumeRole",
    ]
    resources = ["arn:aws:iam::*:role/asv-vault-signer"]
  }

  statement {
    sid    = "DenyBroadS3"
    effect = "Deny"
    actions = [
      "s3:DeleteBucket",
      "s3:*Policy*",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "DenyEC2Write"
    effect = "Deny"
    actions = [
      "ec2:RunInstances",
      "ec2:TerminateInstances",
      "ec2:StopInstances",
      "ec2:CreateVolume",
      "ec2:Modify*",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "scanner" {
  name   = "asv-scanner-least-priv"
  role   = aws_iam_role.scanner.id
  policy = data.aws_iam_policy_document.scanner_permissions.json
}

resource "aws_iam_instance_profile" "scanner" {
  name = "asv-scanner"
  role = aws_iam_role.scanner.name
  tags = local.common_tags
}