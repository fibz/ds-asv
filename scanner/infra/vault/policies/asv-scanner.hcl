# Vault policy for ASV scanner engine
# Path: vault/policies/asv-scanner.hcl

# Request dynamic SSH certificate at scan time
path "ssh/sign/asv-scan" {
  capabilities = ["create", "update"]
}

# Read customer scope definitions
path "secret/data/customers/+/scope" {
  capabilities = ["read"]
}

# Write scan evidence (append-only)
path "secret/data/evidence/+/+" {
  capabilities = ["create"]
}

# DENY reading any customer credentials directly
path "secret/data/customers/+/ssh-private-key" {
  capabilities = ["deny"]
}
