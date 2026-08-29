# SSH role for ASV dynamic certificate signing
# Mount: ssh/roles/asv-scan

{
  "allow_user_certificates": true,
  "allowed_users": "asvscan",
  "allowed_domains": "",
  "allow_bare_domains": false,
  "allow_subdomains": false,
  "default_extensions": {
    "permit-pty": "",
    "permit-port-forwarding": ""
  },
  "key_type": "ca",
  "default_user": "asvscan",
  "ttl": "2h",
  "max_ttl": "4h",
  "allowed_critical_options": "",
  "allowed_extensions": "permit-pty,permit-port-forwarding"
}
