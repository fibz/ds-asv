# Raw infra description (dictated, user's own words)

## 1. Development machine — "heaven"
- IP: 192.168.1.4/24 (this machine)
- Services here: docker, hermes, original codes linked to github

## 2. Deployment server — "purple"
- IP: 74.156.0.13 (Azure VPS)
- Exposed ports: 8443, 22; plus an extra internal NIC
- Services running: docker, greenbone DB   [item removed 2026-09-12 at user request]
- OS: Kali Linux

