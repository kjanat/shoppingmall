# Live container: the compiled binary (game + DJ API), behind traefik.
COMPOSE := docker compose

# Versie voor /api/statusz: zonder tags faalt describe, dan de volle SHA.
export GIT_DESCRIBE := $(shell git describe --tags --dirty 2>/dev/null || git rev-parse HEAD)

.PHONY: help live build up restart stop logs ps sh

help: ## show targets
	@grep -E '^[a-z]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-8s %s\n", $$1, $$2}'

live: build up ## rebuild image + swap the running container to it

build: ## build the image (also re-fetches latest yt-dlp)
	$(COMPOSE) build --pull

up: ## (re)create + start the container
	$(COMPOSE) up -d

restart: ## restart without rebuilding
	$(COMPOSE) restart

stop: ## stop + remove the container
	$(COMPOSE) down

logs: ## follow container logs
	$(COMPOSE) logs -f --tail=100

ps: ## container status + health
	$(COMPOSE) ps

sh: ## shell inside the running container
	$(COMPOSE) exec mall bash
