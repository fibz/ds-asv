# ASV scanner fleet input variables.

variable "mgmt_cidr" {
  description = "CIDR permitted inbound SSH to the scanner fleet (bastion/operator)."
  type        = string
  default     = "10.0.0.0/8"
}

variable "customer_scan_cidrs" {
  description = "Customer target CIDR ranges; scanner egress to scan ports (22/5985/5986/443) is restricted to these plus NVD/HTTPS."
  type        = list(string)
  default     = []
}

variable "evidence_bucket_name" {
  description = "Globally-unique S3 bucket storing scan evidence with object lock."
  type        = string
  default     = "asv-scanner-evidence"
}

variable "scanner_instance_type" {
  description = "EC2 instance type for scanner workers."
  type        = string
  default     = "t3.medium"
}

variable "scanner_desired_capacity" {
  description = "Desired scanner instances per region."
  type        = number
  default     = 2
}

variable "scanner_min_size" {
  description = "Minimum scanner instances per region."
  type        = number
  default     = 1
}

variable "scanner_max_size" {
  description = "Maximum scanner instances per region."
  type        = number
  default     = 10
}

variable "nvd_egress_cidr" {
  description = "Destination allowed for NVD/feed egress (HTTPS). Default: any, scoped to 443."
  type        = string
  default     = "0.0.0.0/0"
}

variable "tags" {
  description = "Common tags applied to all resources."
  type        = map(string)
  default = {
    ManagedBy = "terraform"
    Project   = "asv-scanner"
  }
}