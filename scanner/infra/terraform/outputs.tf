output "asv_egress_ips" {
  value = {
    for r in local.regions : r => aws_eip.scanner_egress[r].public_ip
  }
  description = "Public scanner egress IPs for customer firewall allowlisting."
}

output "evidence_bucket_name" {
  value       = aws_s3_bucket.evidence.id
  description = "S3 evidence bucket (object lock enabled)."
}

output "evidence_bucket_arn" {
  value       = aws_s3_bucket.evidence.arn
  description = "ARN of the S3 evidence bucket."
}

output "scanner_role_arn" {
  value       = aws_iam_role.scanner.arn
  description = "Least-privilege IAM role assumed by scanner instances."
}

output "scanner_egress_cidrs" {
  value       = var.customer_scan_cidrs
  description = "Customer scan CIDRs currently allowlisted for scanner egress."
}