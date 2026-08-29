.PHONY: install test test-integration lint scan-example build-images deploy-staging vault-dev vault-configure

PYTHON = python3.13
VENV = .venv

install:
	$(PYTHON) -m venv $(VENV)
	$(VENV)/bin/pip install -r requirements.txt
	$(VENV)/bin/pip install -r requirements-dev.txt

test:
	$(VENV)/bin/pytest tests/ -v --tb=short --cov=app --cov-report=term-missing

test-integration:
	@if command -v docker >/dev/null 2>&1; then \
		docker compose -f tests/fixtures/docker-compose.yml up -d --build || { echo "docker compose up failed"; exit 1; }; \
		trap 'docker compose -f tests/fixtures/docker-compose.yml down -v' EXIT; \
	else echo "docker not available; running integration tests (compose cases will skip)"; fi; \
	$(VENV)/bin/pytest tests/integration/ -v

lint:
	$(VENV)/bin/black app/ tests/
	$(VENV)/bin/isort app/ tests/
	$(VENV)/bin/flake8 app/ tests/
	$(VENV)/bin/mypy app/ --ignore-missing-imports

scan-example:
	$(VENV)/bin/python -m app.cli scan \
		--target 127.0.0.1 \
		--auth-method ssh-key \
		--private-key ~/.ssh/asv_test_key \
		--username asvscan

build-images:
	docker build -t asv-scanner:latest -f Dockerfile .
	docker build -t asv-scanner-winrm:latest -f Dockerfile.winrm .

deploy-staging:
	cd infra/terraform && terraform workspace select staging
	cd infra/terraform && terraform apply -auto-approve

vault-dev:
	docker run -d --name vault-dev \
		-e VAULT_DEV_ROOT_TOKEN_ID=dev-token \
		-p 8200:8200 hashicorp/vault:latest
	@echo "Vault dev running at http://localhost:8200 (token: dev-token)"
	$(MAKE) vault-configure

vault-configure:
	VAULT_ADDR=http://localhost:8200 VAULT_TOKEN=dev-token \
		$(VENV)/bin/python scripts/configure_vault.py
