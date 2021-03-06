const exec = require("child_process").exec;
const expect = require("chai").expect;
const Kubectl = require("../../src/lib/kubectl");

describe("Functional", function() {
	this.timeout(180000);

	beforeEach(function() {
		process.env.SELECTOR = "app in (test)";
		process.env.DRY_RUN = "false";
		process.env.DIFF = "true";
		process.env.GITHUB_ENABLED = "false";
		process.env.CI_COMMIT_ID = "6fc66dc2a0b75265ed14e45b754731d8c09b26d6";
		process.env.NAMESPACES_DIR = "/test/functional/clusters/namespaces";
		process.env.MANIFESTS_DIR = "/test/functional/clusters/manifests";
		process.env.AVAILABLE_ENABLED = "true";
		process.env.AVAILABLE_TIMEOUT = "60";
		process.env.AVAILABLE_REQUIRED = "true";
		process.env.AVAILABLE_KEEP_ALIVE = "true";
		process.env.AVAILABLE_WEBHOOK = "http://example.com/test";
	});

	describe("when deploying to example cluster", function() {
		it("should deploy without error", function(done) {
			process.env.CONFIGS = "/test/functional/clusters/configs/example-kubeconfig.yaml";

			exec("./src/deployer", function(error, stdout, stderr) {
				expect(error).to.be.null;
				expect(stderr).to.be.empty;
				expect(stdout).not.to.be.empty;
				expect(stdout).to.contain("example-cluster - Getting list of namespaces");
				expect(stdout).to.contain("example-cluster - Create example namespace");
				expect(stdout).to.contain("example-cluster - namespace \"example\" created");
				expect(stdout).to.contain("Sending payload to http://example.com/test/auth-svc for auth-svc with status STARTED/IN_PROGRESS");
				expect(stdout).to.contain("example-cluster - Getting list of deployment,service,secret,job,daemonset,persistentvolumeclaim matching 'app in (test)'");
				expect(stdout).to.contain("example-cluster - Found 0 resources");
				expect(stdout).to.contain("example-cluster - Create auth-svc");
				expect(stdout).to.contain("example-cluster - service \"auth-svc\" created");
				expect(stdout).to.contain("example-cluster - Service:auth-svc is available");
				expect(stdout).to.contain("Finished successfully");
				done();
			});
		});

		afterEach(function() {
			var kubectl = new Kubectl({
				kubeconfig: process.env.CONFIGS
			});
			return kubectl.deleteByName("namespace", "example");
		});
	});

	describe("when deploying multiple deployments cluster", function() {
		it("should deploy without error", function(done) {
			process.env.CONFIGS = "/test/functional/clusters/configs/multi-deployments-kubeconfig.yaml";

			exec("./src/deployer", function(error, stdout, stderr) {
				expect(error).to.be.null;
				expect(stderr).to.be.empty;
				expect(stdout).not.to.be.empty;
				expect(stdout).to.contain("multi-deployments-cluster - Getting list of namespaces");
				expect(stdout).to.contain("multi-deployments-cluster - Create multi-deployments namespace");
				expect(stdout).to.contain("multi-deployments-cluster - namespace \"multi-deployments\" created");
				expect(stdout).to.contain("Sending payload to http://example.com/test/nginx1-deployment for nginx1-deployment with status STARTED/IN_PROGRESS");
				expect(stdout).to.contain("Sending payload to http://example.com/test/nginx2-deployment for nginx2-deployment with status STARTED/IN_PROGRESS");
				expect(stdout).to.contain("multi-deployments-cluster - Getting list of deployment,service,secret,job,daemonset,persistentvolumeclaim matching 'app in (test)'");
				expect(stdout).to.contain("multi-deployments-cluster - Found 0 resources");
				expect(stdout).to.contain("multi-deployments-cluster - Create nginx1-deployment");
				expect(stdout).to.contain("multi-deployments-cluster - Create nginx2-deployment");
				expect(stdout).to.contain("multi-deployments-cluster - deployment \"nginx1-deployment\" created");
				expect(stdout).to.contain("multi-deployments-cluster - deployment \"nginx2-deployment\" created");
				expect(stdout).to.contain("multi-deployments-cluster - Deployment:nginx1-deployment is available");
				expect(stdout).to.contain("multi-deployments-cluster - Deployment:nginx2-deployment is available");
				expect(stdout).to.contain("multi-deployments-cluster - Deployment:nginx1-deployment has 1/1 replicas available");
				expect(stdout).to.contain("multi-deployments-cluster - Deployment:nginx2-deployment has 1/1 replicas available");
				expect(stdout).to.contain("Finished successfully");
				done();
			});
		});

		afterEach(function() {
			var kubectl = new Kubectl({
				kubeconfig: process.env.CONFIGS
			});
			return kubectl.deleteByName("namespace", "multi-deployments");
		});
	});

	describe("when no unique namespaces and deploying to cluster", function() {
		it("should deploy without error", function(done) {
			process.env.CONFIGS = "/test/functional/clusters/configs/no-namespaces-kubeconfig.yaml";

			exec("./src/deployer", function(error, stdout, stderr) {
				expect(error).to.be.null;
				expect(stderr).to.be.empty;
				expect(stdout).not.to.be.empty;
				expect(stdout).to.contain("no-namespaces-cluster - Getting list of namespaces");
				expect(stdout).to.contain("no-namespaces-cluster - Getting list of deployment,service,secret,job,daemonset,persistentvolumeclaim matching 'app in (test)'");
				expect(stdout).to.contain("no-namespaces-cluster - Found 0 resources");
				expect(stdout).to.contain("Finished successfully");
				done();
			});
		});
	});

	describe("when deploying a single job to a cluster", function() {
		it("should deploy without error", function(done) {
			process.env.CONFIGS = "/test/functional/clusters/configs/single-job-kubeconfig.yaml";

			exec("./src/deployer", function(error, stdout, stderr) {
				expect(error).to.be.null;
				expect(stderr).to.be.empty;
				expect(stdout).not.to.be.empty;
				expect(stdout).to.contain("single-job-cluster - Getting list of namespaces");
				expect(stdout).to.contain("Sending payload to http://example.com/test/ls-job for ls-job with status STARTED/IN_PROGRESS");
				expect(stdout).to.contain("single-job-cluster - Getting list of deployment,service,secret,job,daemonset,persistentvolumeclaim matching 'app in (test)'");
				expect(stdout).to.contain("single-job-cluster - Create single-job namespace");
				expect(stdout).to.contain("single-job-cluster - namespace \"single-job\" created");
				expect(stdout).to.contain("single-job-cluster - Found 0 resources");
				expect(stdout).to.contain("single-job-cluster - Create ls-job");
				expect(stdout).to.match(/.*single-job-cluster - job \"ls-job-\b[0-9a-f]{5,40}\b\" created*/);
				expect(stdout).to.match(/.*single-job-cluster - Job:ls-job-\b[0-9a-f]{5,40}\b is available.*/);
				expect(stdout).to.match(/.*single-job-cluster - Job:ls-job-\b[0-9a-f]{5,40}\b has 1\/1 succeeded.*/);
				expect(stdout).to.contain("Finished successfully");
				done();
			});
		});
	});

	afterEach(function() {
		delete process.env.SELECTOR;
		delete process.env.DRY_RUN;
		delete process.env.DIFF;
		delete process.env.NAMESPACES_DIR;
		delete process.env.MANIFESTS_DIR;
		delete process.env.CONFIGS;
		delete process.env.GITHUB_ENABLED;
		delete process.env.CI_COMMIT_ID;
		delete process.env.AVAILABLE_ENABLED;
		delete process.env.AVAILABLE_TIMEOUT;
		delete process.env.AVAILABLE_REQUIRED;
		delete process.env.AVAILABLE_KEEP_ALIVE;
		delete process.env.AVAILABLE_WEB;
	});
});
