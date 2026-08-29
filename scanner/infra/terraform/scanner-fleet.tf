# Multi-region ASV scanner fleet.
# PCI requires scanning from multiple geographic perspectives.

data "aws_ami" "ubuntu_2204" {
  for_each = toset(local.regions)

  provider    = aws[each.value]
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
}

# VPC per region
module "vpc" {
  for_each = toset(local.regions)
  source   = "terraform-aws-modules/vpc/aws"
  version  = "~> 5.0"

  providers = {
    aws = aws[each.value]
  }

  name = "asv-scanner-${each.value}"
  cidr = "10.${index(local.regions, each.value)}.0.0/16"

  azs = ["${each.value}a", "${each.value}b"]
  public_subnets = [
    "10.${index(local.regions, each.value)}.1.0/24",
    "10.${index(local.regions, each.value)}.2.0/24",
  ]

  enable_nat_gateway = false
}

# Launch Template
resource "aws_launch_template" "scanner" {
  for_each = toset(local.regions)

  name_prefix   = "asv-scanner-${each.value}-"
  image_id      = data.aws_ami.ubuntu_2204[each.value].id
  instance_type = var.scanner_instance_type

  vpc_security_group_ids = [aws_security_group.scanner[each.value].id]

  # Enforce IMDSv2 (token required) -- a key metadata choke point.
  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required"
  }

  iam_instance_profile {
    name = aws_iam_instance_profile.scanner.name
  }

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name      = "asv-scanner"
      Region    = each.value
      ManagedBy = "terraform"
    }
  }
}

# Auto Scaling Group
resource "aws_autoscaling_group" "scanner" {
  for_each = toset(local.regions)

  name                = "asv-scanner-${each.value}"
  vpc_zone_identifier = module.vpc[each.value].public_subnets
  desired_capacity    = var.scanner_desired_capacity
  min_size            = var.scanner_min_size
  max_size            = var.scanner_max_size

  launch_template {
    id      = aws_launch_template.scanner[each.value].id
    version = "$Latest"
  }

  tag {
    key                 = "Name"
    value               = "asv-scanner"
    propagate_at_launch = true
  }
  tag {
    key                 = "Region"
    value               = each.value
    propagate_at_launch = true
  }
}

# Security Group: egress restricted to scan ports + NVD HTTPS; ingress only SSH from operators.
resource "aws_security_group" "scanner" {
  for_each  = toset(local.regions)
  provider  = aws[each.value]
  depends_on = [module.vpc]

  name_prefix = "asv-scanner-${each.value}-"
  vpc_id      = module.vpc[each.value].vpc_id

  # NVD / feed egress over HTTPS.
  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.nvd_egress_cidr]
  }

  # Authenticated scanning egress: SSH / WinRM HTTP / WinRM HTTPS to customer
  # CIDR ranges only. If no customer CIDRs are configured, this rule is empty
  # (deny-by-default) instead of the previous wildcard allow.
  dynamic "egress" {
    for_each = var.customer_scan_cidrs
    content {
      from_port   = 22
      to_port     = 22
      protocol    = "tcp"
      cidr_blocks = [egress.value]
    }
  }

  dynamic "egress" {
    for_each = var.customer_scan_cidrs
    content {
      from_port   = 5985
      to_port     = 5986
      protocol    = "tcp"
      cidr_blocks = [egress.value]
    }
  }

  # Operator SSH only.
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.mgmt_cidr]
  }
}

# Elastic IPs published to customers for firewall allowlisting.
resource "aws_eip" "scanner_egress" {
  for_each = toset(local.regions)
  provider = aws[each.value]

  domain = "vpc"

  tags = {
    Name      = "asv-scanner-egress-${each.value}"
    Published = "true"
  }
}