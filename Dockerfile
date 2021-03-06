FROM quay.io/invision/alpine-node:5.5.0

# Defines the version of the kubectl binary
ARG KUBE_VERSION=v1.2.2

# Add kubectl binary
COPY scripts/download-kubectl.js scripts/download-kubectl.js
RUN node scripts/download-kubectl.js

# Install node modules (allows for npm install to be cached until package.json changes)
COPY .npmrc package.json ./
RUN npm install

# Set default environment variables
ENV \
	PATH=/src:/node_modules/.bin:/bin:$PATH\
	API_VERSION=v1\
	SELECTOR=\
	CONFIGS_PATTERN=/configs/**/kubeconfig\
	NAMESPACES_DIR=/namespaces\
	MANIFESTS_DIR=/manifests\
	DRY_RUN=true\
	IS_ROLLBACK=false\
	DIFF=false\
	FORCE=false\
	AVAILABLE_ENABLED=false\
	AVAILABLE_REQUIRED=false\
	AVAILABLE_KEEP_ALIVE=false\
	AVAILABLE_KEEP_ALIVE_INTERVAL=30\
	AVAILABLE_TIMEOUT=600\
	DEPENDENCY_WAIT=3\
	DEPENDENCY_TIMEOUT=600\
	GITHUB_ENABLED=true\
	GITHUB_AUTH_TYPE=token

# Copy our source files to the service location
COPY src /src

ENTRYPOINT ["deployer"]
