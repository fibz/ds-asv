terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Remote state backend. Operational values (bucket / table / key) are
  # provided via the backend config or CLI; do NOT hardcode credentials here.
  # Bootstrap the backend once with:
  #   terraform init -backend-config="bucket=<state-bucket>" \
  #     -backend-config="dynamodb_table=<lock-table>" \
  #     -backend-config="key=asv-scanner/terraform.tfstate"
  backend "s3" {
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  alias  = "us-east-1"
  region = "us-east-1"
}

provider "aws" {
  alias  = "eu-west-1"
  region = "eu-west-1"
}

provider "aws" {
  alias  = "ap-southeast-1"
  region = "ap-southeast-1"
}