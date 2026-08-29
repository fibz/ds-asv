# AGENTS.md - asv-scanner

Run these gate commands before marking work done.

1. make lint
2. make test
3. make test-integration
4. make build-images
5. make vault-dev && make vault-configure

make lint runs black, isort, flake8, mypy and must exit 0.
make test runs pytest with coverage and must pass.
make test-integration skips when docker is absent and exits 0.
make build-images and make vault-dev require docker.

Python 3.13 is the project and container runtime baseline.

Scan executors are Celery tasks. The API uses Celery delay when CELERY_BROKER_URL is set, else FastAPI BackgroundTasks.

Black-box scan degrades to UNAVAILABLE when nmap or testssl.sh is absent.

Scope authorization is CIDR-aware and rejects empty scope.

NVD cache loader: scripts/update_nvd.py. CPEMapper falls back to demo lookup with a warning.
