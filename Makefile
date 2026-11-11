.PHONY: setup migrate seed dev build test test-perf verify smoke

setup:
	npm install
	pip install -r requirements-dev.txt || true

migrate:
	python3 -m backend.scripts.migrate

seed:
	python3 -m backend.scripts.seed

dev:
	npm run dev

build:
	npm run build

test:
	npm test

test-perf:
	npm test

verify: test build migrate smoke

smoke:
	python3 -m backend.scripts.smoke $(URL)
