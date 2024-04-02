.PHONY: none load_env docker-push docker-build

.DEFAULT_GOAL := none

none:
	@echo bleha bleah

IMAGE_REPO ?= us-central1-docker.pkg.dev/nfd-nodes/nodes

# preference would be to fetch version from latest vX.X tag in git
VERSION ?= latest

IMAGE := reti:$(VERSION)

docker-build:
	docker build --no-cache --platform linux/amd64 -f Dockerfile-nodemgr -t $(IMAGE_REPO)/$(IMAGE) .

docker-push: docker-build
	docker push $(IMAGE_REPO)/$(IMAGE)
